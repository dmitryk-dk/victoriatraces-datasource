import { heaviestCriticalSpanId, type CriticalSegment } from './criticalPath';

const path = (entries: Record<string, CriticalSegment[]>) => new Map(Object.entries(entries));

describe('heaviestCriticalSpanId', () => {
  it('names the span owning the most of the critical path', () => {
    // Nearly every ancestor of a deep trace carries some critical segment, so
    // marking them all says almost nothing; this marks the one worth fixing.
    const winner = heaviestCriticalSpanId(
      path({
        root: [{ start: 0, end: 100 }],
        slow: [{ start: 100, end: 900 }],
        quick: [{ start: 900, end: 950 }],
      })
    );
    expect(winner).toBe('slow');
  });

  it('adds up the separate segments of one span', () => {
    const winner = heaviestCriticalSpanId(
      path({
        split: [
          { start: 0, end: 300 },
          { start: 600, end: 900 },
        ],
        single: [{ start: 300, end: 800 }],
      })
    );
    expect(winner).toBe('split');
  });

  it('has no answer for an empty path', () => {
    expect(heaviestCriticalSpanId(new Map())).toBeUndefined();
  });

  it('ignores spans that contribute no time', () => {
    expect(heaviestCriticalSpanId(path({ zero: [{ start: 5, end: 5 }] }))).toBeUndefined();
  });
});
