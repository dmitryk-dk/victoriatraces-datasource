import { formatMicros } from '../utils/format';
import type { ChartSelection } from './heatmapGrid';

/**
 * Pixel maths for the scatter plot: time across, duration up a log scale.
 *
 * Durations are heavy-tailed, so a linear axis collapses the fast majority
 * onto the baseline. Selections use the same shape as the heatmap's, which is
 * what lets a box drawn on one chart appear on the other.
 */

export interface ScatterGeometry {
  width: number;
  height: number;
  startMs: number;
  endMs: number;
  /** Duration extent of the plotted points, in microseconds. */
  minMicros: number;
  maxMicros: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Smallest duration the log scale will accept. */
const FLOOR_MICROS = 1;

/**
 * The duration range to scale against. A run where every trace took the same
 * time is padded, so its points sit in the middle rather than on an edge.
 */
export function durationExtent(rows: ReadonlyArray<{ durationMicros: number }>): {
  minMicros: number;
  maxMicros: number;
} {
  if (rows.length === 0) {
    return { minMicros: 1, maxMicros: 1000 };
  }
  const durations = rows.map((r) => Math.max(r.durationMicros, FLOOR_MICROS));
  const lo = Math.min(...durations);
  const hi = Math.max(...durations);
  if (lo === hi) {
    return { minMicros: lo / 2, maxMicros: hi * 2 };
  }
  return { minMicros: lo, maxMicros: hi };
}

/** Where a trace sits in the plot, in pixels from its top-left corner. */
export function pointPosition(
  startMs: number,
  durationMicros: number,
  geom: ScatterGeometry
): { x: number; y: number } {
  const span = geom.endMs - geom.startMs || 1;
  const x = clamp(((startMs - geom.startMs) / span) * geom.width, 0, geom.width);
  return { x, y: durationToY(durationMicros, geom) };
}

function durationToY(durationMicros: number, geom: ScatterGeometry): number {
  const logLo = Math.log(Math.max(geom.minMicros, FLOOR_MICROS));
  const logSpan = Math.log(Math.max(geom.maxMicros, FLOOR_MICROS)) - logLo;
  if (logSpan <= 0) {
    return geom.height / 2;
  }
  const fraction = (Math.log(Math.max(durationMicros, FLOOR_MICROS)) - logLo) / logSpan;
  // y grows downwards, so the slowest trace sits at the top.
  return clamp(geom.height - fraction * geom.height, 0, geom.height);
}

function yToDuration(y: number, geom: ScatterGeometry): number {
  const logLo = Math.log(Math.max(geom.minMicros, FLOOR_MICROS));
  const logSpan = Math.log(Math.max(geom.maxMicros, FLOOR_MICROS)) - logLo;
  if (logSpan <= 0) {
    return geom.minMicros;
  }
  const fraction = clamp((geom.height - y) / geom.height, 0, 1);
  return Math.exp(logLo + fraction * logSpan);
}

export interface DurationTick {
  /** Position up the axis from the bottom, 0-100. */
  pct: number;
  micros: number;
  label: string;
}

const TICK_MANTISSAS = [1, 2, 5];

/** Least distance between two labels, as a percentage of the axis. */
const MIN_TICK_GAP_PCT = 15;

/**
 * Round duration labels for the log y axis.
 *
 * Only 1-2-5 values are labelled, the way a plotting library labels a log
 * scale: a
 * tick at "3.7ms" tells a reader nothing they can compare against. Labels are
 * chosen from the slowest down, because that is the end a reader looks at
 * first, and any that would land within `MIN_TICK_GAP_PCT` of the one above is
 * skipped rather than drawn on top of it. A range too narrow to hold a round
 * value falls back to its own ends, so the axis is never blank.
 */
export function durationTicks(minMicros: number, maxMicros: number, maxTicks = 6): DurationTick[] {
  const lo = Math.max(minMicros, FLOOR_MICROS);
  const hi = Math.max(maxMicros, lo);
  const logLo = Math.log(lo);
  const logSpan = Math.log(hi) - logLo;

  const at = (micros: number): DurationTick => ({
    pct: logSpan <= 0 ? 50 : ((Math.log(micros) - logLo) / logSpan) * 100,
    micros,
    label: formatMicros(micros),
  });

  const candidates: number[] = [];
  for (let decade = Math.floor(Math.log10(lo)); decade <= Math.ceil(Math.log10(hi)); decade++) {
    for (const mantissa of TICK_MANTISSAS) {
      const value = mantissa * 10 ** decade;
      if (value >= lo && value <= hi) {
        candidates.push(value);
      }
    }
  }

  if (candidates.length < 2) {
    return [at(lo), at(hi)];
  }

  const kept: DurationTick[] = [];
  for (let i = candidates.length - 1; i >= 0 && kept.length < maxTicks; i--) {
    const tick = at(candidates[i]);
    const above = kept[kept.length - 1];
    if (!above || above.pct - tick.pct >= MIN_TICK_GAP_PCT) {
      kept.push(tick);
    }
  }

  if (kept.length < 2) {
    return [at(lo), at(hi)];
  }

  // Anchor the bottom: an axis whose lowest label floats above the plot floor
  // leaves the fastest dots with nothing to read against. The lowest label
  // moves down to the smallest round value whenever that keeps its distance
  // from the one above it.
  const lowest = at(candidates[0]);
  const above = kept[kept.length - 2];
  if (kept[kept.length - 1].micros !== lowest.micros && above.pct - lowest.pct >= MIN_TICK_GAP_PCT) {
    kept[kept.length - 1] = lowest;
  }

  return kept.reverse();
}

/** Bubble diameter for a trace's span count. */
export function bubbleDiameter(spans: number): number {
  return clamp(4 + Math.sqrt(Math.max(spans, 0)) * 1.4, 5, 20);
}

/**
 * The window a dragged box covers. A box touching an edge is left open on that
 * side: dragging past the top means "and anything slower", not a bound at the
 * slowest trace that happens to be loaded.
 */
export function rectToSelection(
  rect: { x1: number; y1: number; x2: number; y2: number },
  geom: ScatterGeometry
): ChartSelection {
  const x1 = Math.min(rect.x1, rect.x2);
  const x2 = Math.max(rect.x1, rect.x2);
  const y1 = Math.min(rect.y1, rect.y2);
  const y2 = Math.max(rect.y1, rect.y2);
  const span = geom.endMs - geom.startMs || 1;

  return {
    startMicros: (geom.startMs + (x1 / geom.width) * span) * 1000,
    endMicros: (geom.startMs + (x2 / geom.width) * span) * 1000,
    minDurationMicros: y2 >= geom.height ? 0 : yToDuration(y2, geom),
    maxDurationMicros: y1 <= 0 ? Number.POSITIVE_INFINITY : yToDuration(y1, geom),
  };
}

/** Where to draw a selection, clipped to the plot. */
export function selectionToRect(
  selection: ChartSelection,
  geom: ScatterGeometry
): { x1: number; y1: number; x2: number; y2: number } {
  const span = geom.endMs - geom.startMs || 1;
  const toX = (micros: number) =>
    clamp(((micros / 1000 - geom.startMs) / span) * geom.width, 0, geom.width);

  return {
    x1: toX(selection.startMicros),
    y1: Number.isFinite(selection.maxDurationMicros)
      ? durationToY(selection.maxDurationMicros, geom)
      : 0,
    x2: toX(selection.endMicros),
    y2: selection.minDurationMicros > 0 ? durationToY(selection.minDurationMicros, geom) : geom.height,
  };
}
