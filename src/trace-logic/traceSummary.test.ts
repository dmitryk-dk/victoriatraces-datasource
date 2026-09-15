import {
  computeSelfTimes,
  type SpanSummary,
  summarizeTrace,
} from './traceSummary';

function span(
  spanId: string,
  service: string,
  operation: string,
  startMicros: number,
  durationMicros: number,
  parentSpanId?: string,
  error = false,
): SpanSummary {
  return {
    spanId,
    parentSpanId,
    service,
    operation,
    durationMicros,
    startMicros,
    error,
  };
}

describe('computeSelfTimes', () => {
  it('a wrapper parent keeps only the time its children do not cover', () => {
    const spans = [
      span('root', 'a', 'op', 0, 100),
      span('child', 'a', 'op', 10, 80, 'root'),
    ];
    const self = computeSelfTimes(spans);
    expect(self.get('root')).toBe(20);
    expect(self.get('child')).toBe(80);
  });

  it('parallel (overlapping) children are merged, not double-subtracted', () => {
    const spans = [
      span('root', 'a', 'op', 0, 100),
      span('c1', 'a', 'op', 0, 60, 'root'),
      span('c2', 'a', 'op', 30, 60, 'root'), // overlaps c1 by 30
    ];
    // Union of children covers 0..90 → self = 10, not 100 − 120.
    expect(computeSelfTimes(spans).get('root')).toBe(10);
  });

  it('children clipped to the parent window; self never negative', () => {
    const spans = [
      span('root', 'a', 'op', 0, 50),
      // Malformed child overflowing its parent.
      span('c1', 'a', 'op', 40, 100, 'root'),
    ];
    expect(computeSelfTimes(spans).get('root')).toBe(40);
  });
});

describe('summarizeTrace', () => {
  it('empty trace → empty summary', () => {
    const s = summarizeTrace([]);
    expect(s.spanCount).toBe(0);
    expect(s.services).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it('nested chains do not double-count: service totals ≤ trace duration', () => {
    // The bug report shape: a 6.5ms trace whose per-service sums showed 13ms
    // because each span in the chain re-counted the same wall-clock time.
    const spans = [
      span('ingress', 'proxy', 'ingress', 0, 6500),
      span('router', 'proxy', 'router', 100, 6200, 'ingress'),
      span('post', 'frontend', 'POST', 200, 6000, 'router'),
      span('api', 'frontend', 'POST /api', 300, 5800, 'post'),
    ];
    const s = summarizeTrace(spans);
    const total = s.services.reduce((sum, svc) => sum + svc.selfMicros, 0);
    expect(total).toBeLessThanOrEqual(6500);
    // frontend self = 200 (post) + 5800 (api leaf); proxy = 400+100.
    expect(s.services[0]).toMatchObject({
      service: 'frontend',
      selfMicros: 6000,
      spanCount: 2,
    });
    expect(s.services[1]).toMatchObject({
      service: 'proxy',
      selfMicros: 500,
      spanCount: 2,
    });
  });

  it('parallel siblings: self-time totals CAN exceed the wall duration', () => {
    // Work stacks while the clock does not — two concurrent 90µs children
    // inside a 100µs root yield 185µs of work in 100µs of wall time. This is
    // the CPU-time-vs-wall-time property, not double counting.
    const spans = [
      span('root', 'a', 'op', 0, 100),
      span('c1', 'a', 'op', 0, 90, 'root'),
      span('c2', 'a', 'op', 5, 90, 'root'),
    ];
    const s = summarizeTrace(spans);
    const total = s.services.reduce((sum, svc) => sum + svc.selfMicros, 0);
    expect(total).toBeGreaterThan(100);
    expect(total).toBe(185); // c1 90 + c2 90 + root self 5 (95..100)
  });

  it('lists errors chronologically with offsets from the trace start', () => {
    const s = summarizeTrace([
      span('a', 'frontend', 'GET', 1_000_000, 100),
      span('b', 'payment', 'Charge', 1_250_000, 50, 'a', true),
      span('c', 'cart', 'HGET', 1_100_000, 20, 'a', true),
    ]);
    expect(s.errors).toEqual([
      { service: 'cart', operation: 'HGET', offsetMicros: 100_000 },
      { service: 'payment', operation: 'Charge', offsetMicros: 250_000 },
    ]);
  });
});
