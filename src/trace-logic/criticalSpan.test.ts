import { findCriticalSpan } from './criticalSpan';
import type { SpanSummary } from './traceSummary';

function span(
  spanId: string,
  service: string,
  operation: string,
  startMicros: number,
  durationMicros: number,
  parentSpanId?: string,
): SpanSummary {
  return {
    spanId,
    parentSpanId,
    service,
    operation,
    durationMicros,
    startMicros,
    error: false,
  };
}

describe('findCriticalSpan', () => {
  it('empty trace → undefined', () => {
    expect(findCriticalSpan([])).toBeUndefined();
  });

  it('a long-working leaf owns the critical path, not its wrapping root', () => {
    const spans = [
      span('root', 'front', 'GET', 0, 1000),
      span('db', 'mysql', 'SELECT', 50, 900, 'root'), // gates the trace
      span('tiny', 'front', 'render', 960, 20, 'root'),
    ];
    const cs = findCriticalSpan(spans);
    expect(cs?.span.spanId).toBe('db');
    expect(cs?.criticalMicros).toBe(900);
  });

  it('parallel siblings: only the last-finishing child gates the trace', () => {
    const spans = [
      span('root', 'a', 'op', 0, 100),
      span('fast', 'a', 'op', 0, 40, 'root'),
      span('slow', 'a', 'op', 0, 95, 'root'), // finishes last → critical
    ];
    const cs = findCriticalSpan(spans);
    expect(cs?.span.spanId).toBe('slow');
    expect(cs?.criticalMicros).toBe(95);
  });

  it('sequential children split the path; the longest segment owner wins', () => {
    const spans = [
      span('root', 'a', 'op', 0, 100),
      span('c1', 'a', 'first', 0, 30, 'root'),
      span('c2', 'a', 'second', 30, 65, 'root'),
    ];
    const cs = findCriticalSpan(spans);
    expect(cs?.span.spanId).toBe('c2');
    expect(cs?.criticalMicros).toBe(65);
  });
});
