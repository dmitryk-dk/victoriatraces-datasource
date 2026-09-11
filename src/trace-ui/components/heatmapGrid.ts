import type { HeatmapCell } from '../api/traceList';

/**
 * Layout and pointer maths for the heatmap grid.
 *
 * Kept apart from the component so the pixel ↔ (bucket, band) ↔ selection
 * conversions can be tested without a DOM, and so the scatter plot can share
 * the same selection shape.
 */

/** A time and duration window, as visum's HeatmapSelection. */
export interface ChartSelection {
  startMicros: number;
  endMicros: number;
  minDurationMicros: number;
  /** Infinity when the slowest band is included, which is open-ended. */
  maxDurationMicros: number;
}

export interface HeatmapGeometry {
  /** Size of the plotting area in CSS pixels. */
  width: number;
  height: number;
  xCount: number;
  yBins: number;
  startMs: number;
  stepMs: number;
  edgesNs: number[];
}

export interface HeatmapRow {
  yi: number;
  cells: Map<number, { count: number; errors: number }>;
}

export interface HeatmapLayout {
  rows: HeatmapRow[];
  /** Extents over populated cells, for the colour scale. */
  minCount: number;
  maxCount: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nudge off a boundary pixel, so a trailing edge stays in its own bucket. */
const EDGE_EPSILON = 1e-6;

/**
 * One row per duration bin, slowest first.
 *
 * Every bin is rendered, including empty ones: a band's position is what lets
 * a reader compare durations across refreshes, and dropping empty bands moves
 * all the others.
 */
export function heatmapRows(cells: readonly HeatmapCell[], yBins: number): HeatmapLayout {
  const byRow = new Map<number, Map<number, { count: number; errors: number }>>();
  let maxCount = 0;
  let minCount = Number.POSITIVE_INFINITY;

  for (const cell of cells) {
    let row = byRow.get(cell.yi);
    if (!row) {
      row = new Map();
      byRow.set(cell.yi, row);
    }
    row.set(cell.xi, { count: cell.count, errors: cell.errors });
    maxCount = Math.max(maxCount, cell.count);
    minCount = Math.min(minCount, cell.count);
  }

  const rows: HeatmapRow[] = [];
  for (let yi = yBins - 1; yi >= 0; yi--) {
    rows.push({ yi, cells: byRow.get(yi) ?? new Map() });
  }
  return { rows, minCount: Number.isFinite(minCount) ? minCount : 0, maxCount };
}

/** Microsecond bounds of a duration bin; the outer bins are open-ended. */
export function binBounds(yi: number, edgesNs: readonly number[]): {
  minMicros: number;
  maxMicros: number;
} {
  const lower = yi === 0 ? 0 : edgesNs[yi - 1] / 1000;
  const upper = yi >= edgesNs.length ? Number.POSITIVE_INFINITY : edgesNs[yi] / 1000;
  return { minMicros: lower, maxMicros: upper };
}

/** The bucket and band under a point in the plotting area. */
export function cellAt(x: number, y: number, geom: HeatmapGeometry): { xi: number; yi: number } {
  const xi = clamp(Math.floor((x / geom.width) * geom.xCount), 0, geom.xCount - 1);
  const rowFromTop = clamp(Math.floor((y / geom.height) * geom.yBins), 0, geom.yBins - 1);
  return { xi, yi: geom.yBins - 1 - rowFromTop };
}

/**
 * The window a dragged box covers.
 *
 * Every bucket and band the box touches is included whole, so the drilled
 * result matches the counts of the cells the box visibly covers.
 */
export function rectToSelection(
  rect: { x1: number; y1: number; x2: number; y2: number },
  geom: HeatmapGeometry
): ChartSelection {
  const x1 = Math.min(rect.x1, rect.x2);
  const x2 = Math.max(rect.x1, rect.x2);
  const y1 = Math.min(rect.y1, rect.y2);
  const y2 = Math.max(rect.y1, rect.y2);

  // The trailing edges are exclusive: a box drawn up to a bucket's left edge
  // covers the buckets before it, not the one it merely touches.
  const a = cellAt(x1, y1, geom);
  const b = cellAt(Math.max(x1, x2 - EDGE_EPSILON), Math.max(y1, y2 - EDGE_EPSILON), geom);
  const xiLo = Math.min(a.xi, b.xi);
  const xiHi = Math.max(a.xi, b.xi);
  const yiLo = Math.min(a.yi, b.yi);
  const yiHi = Math.max(a.yi, b.yi);

  return {
    startMicros: (geom.startMs + xiLo * geom.stepMs) * 1000,
    endMicros: (geom.startMs + (xiHi + 1) * geom.stepMs) * 1000,
    minDurationMicros: binBounds(yiLo, geom.edgesNs).minMicros,
    maxDurationMicros: binBounds(yiHi, geom.edgesNs).maxMicros,
  };
}

/** Where to draw a selection, clipped to the plotting area. */
export function selectionToRect(
  selection: ChartSelection,
  geom: HeatmapGeometry
): { x1: number; y1: number; x2: number; y2: number } {
  const spanMs = geom.xCount * geom.stepMs;
  const toX = (micros: number) =>
    clamp(((micros / 1000 - geom.startMs) / spanMs) * geom.width, 0, geom.width);

  // A band's row runs from the top, so the slower bound is the smaller y.
  const bandTop = (yi: number) => ((geom.yBins - 1 - yi) / geom.yBins) * geom.height;
  const rowHeight = geom.height / geom.yBins;

  let yiLo = 0;
  while (yiLo < geom.yBins - 1 && binBounds(yiLo, geom.edgesNs).maxMicros <= selection.minDurationMicros) {
    yiLo++;
  }
  let yiHi = geom.yBins - 1;
  while (yiHi > 0 && binBounds(yiHi, geom.edgesNs).minMicros >= selection.maxDurationMicros) {
    yiHi--;
  }

  return {
    x1: toX(selection.startMicros),
    y1: clamp(bandTop(yiHi), 0, geom.height),
    x2: toX(selection.endMicros),
    y2: clamp(bandTop(yiLo) + rowHeight, 0, geom.height),
  };
}
