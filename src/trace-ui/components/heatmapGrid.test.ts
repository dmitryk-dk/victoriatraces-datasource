import {
  binBounds,
  cellAt,
  heatmapRows,
  rectToSelection,
  selectionToRect,
  type HeatmapGeometry,
} from './heatmapGrid';
import type { HeatmapCell } from '../api/traceList';

// Three edges make four bins: <1ms, 1–10ms, 10–100ms, ≥100ms.
const EDGES_NS = [1e6, 1e7, 1e8];
const Y_BINS = EDGES_NS.length + 1;

const cell = (xi: number, yi: number, count: number, errors = 0): HeatmapCell => ({
  xi,
  yi,
  count,
  errors,
});

const geometry: HeatmapGeometry = {
  width: 400,
  height: 80,
  xCount: 4,
  yBins: Y_BINS,
  startMs: 1_700_000_000_000,
  stepMs: 60_000,
  edgesNs: EDGES_NS,
};

describe('heatmapRows', () => {
  it('renders every duration bin, not only the populated ones', () => {
    // A band's height on screen is what makes durations comparable between
    // refreshes; dropping empty bands moves every other one.
    const { rows } = heatmapRows([cell(0, 1, 5)], Y_BINS);
    expect(rows).toHaveLength(Y_BINS);
  });

  it('puts the slowest band at the top', () => {
    expect(heatmapRows([], Y_BINS).rows.map((r) => r.yi)).toEqual([3, 2, 1, 0]);
  });

  it('keys each row\'s cells by time bucket', () => {
    const { rows } = heatmapRows([cell(2, 1, 5, 1)], Y_BINS);
    const row = rows.find((r) => r.yi === 1)!;
    expect(row.cells.get(2)).toEqual({ count: 5, errors: 1 });
    expect(row.cells.get(0)).toBeUndefined();
  });

  it('reports the busiest and least busy populated cells', () => {
    const { maxCount, minCount } = heatmapRows([cell(0, 1, 5), cell(1, 2, 40)], Y_BINS);
    expect(minCount).toBe(5);
    expect(maxCount).toBe(40);
  });
});

describe('binBounds', () => {
  it('leaves the fastest bin open below', () => {
    expect(binBounds(0, EDGES_NS)).toEqual({ minMicros: 0, maxMicros: 1000 });
  });

  it('leaves the slowest bin open above', () => {
    expect(binBounds(3, EDGES_NS)).toEqual({ minMicros: 100_000, maxMicros: Infinity });
  });

  it('bounds a middle bin on both sides', () => {
    expect(binBounds(1, EDGES_NS)).toEqual({ minMicros: 1000, maxMicros: 10_000 });
  });
});

describe('cellAt', () => {
  it('finds the bucket under the pointer', () => {
    // x = 250/400 of four buckets = bucket 2; y = 10/80 is the top row, the
    // slowest band.
    expect(cellAt(250, 10, geometry)).toEqual({ xi: 2, yi: 3 });
  });

  it('reads the bottom row as the fastest band', () => {
    expect(cellAt(10, 79, geometry)).toEqual({ xi: 0, yi: 0 });
  });

  it('clamps a pointer on the far edge into the last bucket', () => {
    expect(cellAt(400, 80, geometry)).toEqual({ xi: 3, yi: 0 });
  });
});

describe('rectToSelection', () => {
  it('covers the whole of every bucket the box touches', () => {
    // Buckets 0–1, bands 0–1: the window runs to the end of bucket 1.
    const selection = rectToSelection({ x1: 10, y1: 45, x2: 150, y2: 79 }, geometry);
    expect(selection).toEqual({
      startMicros: 1_700_000_000_000_000,
      endMicros: 1_700_000_120_000_000,
      minDurationMicros: 0,
      maxDurationMicros: 10_000,
    });
  });

  it('leaves the slowest band unbounded above', () => {
    const selection = rectToSelection({ x1: 0, y1: 0, x2: 399, y2: 10 }, geometry);
    expect(selection.maxDurationMicros).toBe(Infinity);
  });
});

describe('selectionToRect', () => {
  it('is the inverse of rectToSelection for a box on bucket boundaries', () => {
    const rect = { x1: 0, y1: 40, x2: 200, y2: 80 };
    expect(selectionToRect(rectToSelection(rect, geometry), geometry)).toEqual(rect);
  });

  it('clips a selection wider than the chart', () => {
    const rect = selectionToRect(
      {
        startMicros: 1_600_000_000_000_000,
        endMicros: 1_800_000_000_000_000,
        minDurationMicros: 0,
        maxDurationMicros: Infinity,
      },
      geometry
    );
    expect(rect).toEqual({ x1: 0, y1: 0, x2: 400, y2: 80 });
  });
});
