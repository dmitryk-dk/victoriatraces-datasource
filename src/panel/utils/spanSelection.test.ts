import { resolveSelectedSpan, type SpanSelection } from './spanSelection';

const selection = (traceID: string, spanID?: string): SpanSelection => ({ traceID, spanID });

describe('resolveSelectedSpan', () => {
  it('honours the span the query carried in when nothing is selected', () => {
    expect(resolveSelectedSpan(null, 'trace-1', 'span-a')).toBe('span-a');
  });

  it('prefers a selection made in the trace on screen', () => {
    expect(resolveSelectedSpan(selection('trace-1', 'span-b'), 'trace-1', 'span-a')).toBe('span-b');
  });

  it('drops a selection belonging to another trace', () => {
    // Opening a second trace must land on its own matched span, not stay on
    // the span picked in the first one.
    expect(resolveSelectedSpan(selection('trace-1', 'span-b'), 'trace-2', 'span-a')).toBe('span-a');
  });

  it('keeps details closed when the user closed them in this trace', () => {
    expect(resolveSelectedSpan(selection('trace-1', undefined), 'trace-1', 'span-a')).toBeUndefined();
  });

  it('reopens the carried-in span once a different trace is shown', () => {
    expect(resolveSelectedSpan(selection('trace-1', undefined), 'trace-2', 'span-a')).toBe('span-a');
  });

  it('has nothing to select without a trace', () => {
    expect(resolveSelectedSpan(selection('trace-1', 'span-b'), undefined, undefined)).toBeUndefined();
  });
});
