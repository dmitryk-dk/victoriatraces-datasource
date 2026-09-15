import { drillDurationFilter } from './chartDrill';
import type { TraceFilter } from './types';

const selection = (minMicros: number, maxMicros: number) => ({
  startMicros: 0,
  endMicros: 0,
  minDurationMicros: minMicros,
  maxDurationMicros: maxMicros,
});

const duration = (min?: string, max?: string): TraceFilter => ({ kind: 'duration', min, max });

describe('drillDurationFilter', () => {
  it('turns a selection into a duration filter', () => {
    expect(drillDurationFilter(undefined, selection(3000, 10_000))).toEqual({
      kind: 'duration',
      min: '3000us',
      max: '10000us',
    });
  });

  it('leaves an open-ended selection unbounded', () => {
    expect(drillDurationFilter(undefined, selection(0, Infinity))).toBeUndefined();
  });

  it('keeps the active filter where the selection is open', () => {
    expect(drillDurationFilter(duration('5ms', '1s'), selection(0, Infinity))).toEqual({
      kind: 'duration',
      min: '5000us',
      max: '1000000us',
    });
  });

  it('narrows to the tighter of the two bounds', () => {
    // A selection must never widen an active filter: a full-height drag on a
    // filtered chart would otherwise resurrect the rows it excluded.
    expect(drillDurationFilter(duration('5ms', '1s'), selection(1000, 500_000))).toEqual({
      kind: 'duration',
      min: '5000us',
      max: '500000us',
    });
  });

  it('rounds fractional microseconds', () => {
    expect(drillDurationFilter(undefined, selection(3162.2776, 31_622.776))).toEqual({
      kind: 'duration',
      min: '3162us',
      max: '31623us',
    });
  });

  it('ignores an unparseable active bound', () => {
    expect(drillDurationFilter(duration('soon', undefined), selection(1000, Infinity))).toEqual({
      kind: 'duration',
      min: '1000us',
      max: undefined,
    });
  });
});
