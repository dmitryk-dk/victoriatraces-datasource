import {
  durationTicks,
  bubbleDiameter,
  durationExtent,
  pointPosition,
  rectToSelection,
  selectionToRect,
  type ScatterGeometry,
} from './scatterGeometry';

const geometry: ScatterGeometry = {
  width: 200,
  height: 100,
  startMs: 1_000_000,
  endMs: 1_100_000,
  // Two decades of duration: 1ms to 100ms, in microseconds.
  minMicros: 1000,
  maxMicros: 100_000,
};

describe('durationExtent', () => {
  it('spans the fastest and slowest trace', () => {
    expect(durationExtent([{ durationMicros: 40 }, { durationMicros: 900 }])).toEqual({
      minMicros: 40,
      maxMicros: 900,
    });
  });

  it('pads a single distinct duration so it does not sit on an edge', () => {
    expect(durationExtent([{ durationMicros: 50 }, { durationMicros: 50 }])).toEqual({
      minMicros: 25,
      maxMicros: 100,
    });
  });

  it('falls back to a sane range with no points', () => {
    expect(durationExtent([])).toEqual({ minMicros: 1, maxMicros: 1000 });
  });

  it('never reports a duration below a microsecond', () => {
    expect(durationExtent([{ durationMicros: 0 }]).minMicros).toBeGreaterThan(0);
  });
});

describe('pointPosition', () => {
  it('places a trace by start time across the width', () => {
    expect(pointPosition(1_050_000, 10_000, geometry).x).toBe(100);
  });

  it('places duration logarithmically, slowest at the top', () => {
    // 10ms is the midpoint of 1ms–100ms on a log scale.
    expect(pointPosition(1_000_000, 10_000, geometry).y).toBeCloseTo(50, 6);
    expect(pointPosition(1_000_000, 100_000, geometry).y).toBe(0);
    expect(pointPosition(1_000_000, 1_000, geometry).y).toBe(100);
  });

  it('clamps a trace outside the range onto the edge', () => {
    expect(pointPosition(900_000, 10_000, geometry).x).toBe(0);
    expect(pointPosition(1_500_000, 10_000, geometry).x).toBe(200);
  });
});

describe('bubbleDiameter', () => {
  it('grows with the square root of the span count', () => {
    // clamp(4 + sqrt(spans) * 1.4, 5, 20).
    expect(bubbleDiameter(100)).toBe(18);
  });

  it('keeps a tiny trace visible', () => {
    expect(bubbleDiameter(0)).toBe(5);
    expect(bubbleDiameter(1)).toBe(5.4);
  });

  it('caps a huge trace so it cannot swamp the plot', () => {
    expect(bubbleDiameter(100_000)).toBe(20);
  });
});

describe('rectToSelection', () => {
  it('converts a box into a time and duration window', () => {
    const selection = rectToSelection({ x1: 50, y1: 25, x2: 150, y2: 75 }, geometry);
    expect(selection.startMicros).toBe(1_025_000_000);
    expect(selection.endMicros).toBe(1_075_000_000);
    // A quarter and three quarters up two decades: ~31.6ms and ~3.16ms.
    expect(selection.maxDurationMicros).toBeCloseTo(31_622.78, 1);
    expect(selection.minDurationMicros).toBeCloseTo(3162.28, 1);
  });

  it('leaves a box reaching the top open above', () => {
    const selection = rectToSelection({ x1: 0, y1: 0, x2: 200, y2: 50 }, geometry);
    expect(selection.maxDurationMicros).toBe(Infinity);
  });

  it('leaves a box reaching the bottom open below', () => {
    const selection = rectToSelection({ x1: 0, y1: 50, x2: 200, y2: 100 }, geometry);
    expect(selection.minDurationMicros).toBe(0);
  });
});

describe('selectionToRect', () => {
  it('round-trips a box back to where it was drawn', () => {
    const rect = { x1: 50, y1: 25, x2: 150, y2: 75 };
    const back = selectionToRect(rectToSelection(rect, geometry), geometry);
    expect(back.x1).toBeCloseTo(50, 6);
    expect(back.y1).toBeCloseTo(25, 6);
    expect(back.x2).toBeCloseTo(150, 6);
    expect(back.y2).toBeCloseTo(75, 6);
  });

  it('clips an open-ended selection to the plot', () => {
    expect(
      selectionToRect(
        {
          startMicros: 0,
          endMicros: 9_000_000_000,
          minDurationMicros: 0,
          maxDurationMicros: Infinity,
        },
        geometry
      )
    ).toEqual({ x1: 0, y1: 0, x2: 200, y2: 100 });
  });
});

describe('durationTicks', () => {
  it('lands on round 1-2-5 durations inside the range', () => {
    // Arbitrary tick values ("3.7ms") make a log axis unreadable; a
    // uPlot log axis labels round values only.
    const ticks = durationTicks(1_000, 1_000_000);
    for (const tick of ticks) {
      const mantissa = tick.micros / 10 ** Math.floor(Math.log10(tick.micros));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
      expect(tick.micros).toBeGreaterThanOrEqual(1_000);
      expect(tick.micros).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('positions a tick where the plot would draw that duration', () => {
    const geom = { width: 100, height: 200, startMs: 0, endMs: 1, minMicros: 1_000, maxMicros: 1_000_000 };
    for (const tick of durationTicks(geom.minMicros, geom.maxMicros)) {
      const { y } = pointPosition(0, tick.micros, geom);
      // pct is measured up from the bottom; y grows downwards.
      expect(100 - (y / geom.height) * 100).toBeCloseTo(tick.pct, 6);
    }
  });

  it('keeps the label count readable over many decades', () => {
    const ticks = durationTicks(1, 100_000_000);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it('never places two labels close enough to collide', () => {
    // Thinning by stride and then re-adding the last value left the top two
    // labels a few pixels apart, so they overlapped into one smudge.
    for (const [lo, hi] of [
      [1_000, 1_000_000],
      [55, 9_000_000],
      [1, 100_000_000],
      [2_000, 300_000],
      [900, 4_000],
    ]) {
      const pcts = durationTicks(lo, hi).map((t) => t.pct);
      for (let i = 1; i < pcts.length; i++) {
        // 15% of a 160px axis is 24px, clear of a 10px label.
        expect(pcts[i] - pcts[i - 1]).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('anchors the axis at both ends when the ends are round values', () => {
    // A label dropped at the bottom leaves the axis floating above the plot
    // floor, so the fastest dots have nothing to be read against.
    const ticks = durationTicks(1_000, 1_000_000);
    expect(ticks[0].pct).toBe(0);
    expect(ticks[ticks.length - 1].pct).toBe(100);
  });

  it('labels the slowest round value in range, which is what gets read first', () => {
    const ticks = durationTicks(1_000, 1_000_000);
    expect(ticks[ticks.length - 1].micros).toBe(1_000_000);
  });

  it('still gives the endpoints when the range holds no round value', () => {
    const ticks = durationTicks(1_100, 1_900);
    expect(ticks).toHaveLength(2);
    expect(ticks[0].micros).toBeCloseTo(1_100, 6);
    expect(ticks[1].micros).toBeCloseTo(1_900, 6);
  });
});
