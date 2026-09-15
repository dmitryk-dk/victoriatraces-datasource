import {
  formatClock,
  interpolateColor,
  makePalette,
  paletteIndex,
  PALETTE_STEPS,
  durationAxisTicks,
  timeAxisTicks,
} from './heatmapScale';

describe('interpolateColor', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('blends at the midpoint', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('accepts shorthand hex', () => {
    expect(interpolateColor('#000', '#fff', 1)).toBe('#ffffff');
  });
});

describe('makePalette', () => {
  it('produces a ramp anchored at both endpoints', () => {
    const palette = makePalette('#000000', '#ffffff');
    expect(palette).toHaveLength(PALETTE_STEPS);
    expect(palette[0]).toBe('#000000');
    expect(palette[PALETTE_STEPS - 1]).toBe('#ffffff');
  });
});

describe('paletteIndex', () => {
  it('puts the busiest cell at the top of the ramp', () => {
    expect(paletteIndex(10, 1, 10)).toBe(PALETTE_STEPS - 1);
  });

  it('scales linearly between the least and most busy cells', () => {
    // The ramp is linear across the populated range; the quietest cell sits
    // at the bottom of the ramp rather than in the middle of it.
    expect(paletteIndex(1, 1, 100)).toBe(0);
    expect(paletteIndex(50, 1, 100)).toBe(Math.floor((PALETTE_STEPS * 49) / 99));
  });

  it('puts a grid of equal counts at the bottom of the ramp', () => {
    expect(paletteIndex(7, 7, 7)).toBe(0);
  });

  it('handles empty and degenerate input', () => {
    expect(paletteIndex(0, 1, 10)).toBe(0);
    expect(paletteIndex(5, 0, 0)).toBe(0);
  });
});

describe('timeAxisTicks', () => {
  it('lands ticks on round clock boundaries', () => {
    // A one-hour span starting mid-minute still ticks on whole minutes.
    const start = Date.UTC(2026, 8, 1, 10, 0, 30);
    const ticks = timeAxisTicks(start, start + 60 * 60_000);

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.label).toMatch(/^\d{2}:\d{2}$/);
      expect(tick.pct).toBeGreaterThanOrEqual(0);
      expect(tick.pct).toBeLessThanOrEqual(100);
    }
  });

  it('gives roughly the requested number of ticks', () => {
    const start = Date.UTC(2026, 8, 1, 10, 0, 0);
    const ticks = timeAxisTicks(start, start + 60 * 60_000, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(12);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(timeAxisTicks(1000, 1000)).toEqual([]);
    expect(timeAxisTicks(2000, 1000)).toEqual([]);
  });
});

describe('formatClock', () => {
  it('pads to HH:MM', () => {
    expect(formatClock(new Date(2026, 8, 1, 9, 5).getTime())).toBe('09:05');
  });
});

describe('timeAxisTicks at sub-minute steps', () => {
  it('falls back to HH:MM:SS when HH:MM would repeat', () => {
    // A 30-second window ticks every few seconds; every label would read the
    // same minute, which tells the reader nothing about where they are.
    const start = new Date('2026-09-11T15:29:00Z').getTime();
    const ticks = timeAxisTicks(start, start + 30_000);

    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks.map((t) => t.label)).size).toBe(ticks.length);
    expect(ticks[0].label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('keeps HH:MM when the labels are already distinct', () => {
    const start = new Date('2026-09-11T14:00:00Z').getTime();
    const ticks = timeAxisTicks(start, start + 3_600_000);

    expect(ticks[0].label).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('durationAxisTicks', () => {
  // Bands are log-spaced; five positions are labelled (0, ¼, ½, ¾, 1 of the
  // band axis) rather than every band, which is unreadable at 16 bands.
  const edgesNs = Array.from({ length: 16 }, (_, i) => 1_000 * 10 ** (i / 2));

  it('labels five positions up the axis', () => {
    const ticks = durationAxisTicks(edgesNs);
    expect(ticks).toHaveLength(5);
    expect(ticks.map((t) => t.pct)).toEqual([0, 25, 50, 75, 100]);
  });

  it('runs fastest at the bottom and slowest at the top', () => {
    const ticks = durationAxisTicks(edgesNs);
    expect(ticks[0].micros).toBeLessThan(ticks[4].micros);
  });

  it('interpolates a duration in log space between band edges', () => {
    // Halfway up two decades of bands is one decade, not the arithmetic mean.
    const ticks = durationAxisTicks([1_000, 10_000, 100_000, 1_000_000, 10_000_000]);
    expect(ticks[2].micros).toBeCloseTo(100, 6);
  });

  it('returns nothing without bands', () => {
    expect(durationAxisTicks([])).toEqual([]);
  });
});
