// Scale and palette helpers ported from visum's TracesHeatmap. The colour
// endpoints come from the Grafana theme rather than visum's hardcoded hex, so
// the grid reads correctly in both light and dark.

import { formatMicros } from '../utils/format';

export const PALETTE_STEPS = 16;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = parseInt(full, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Blends two hex colours; factor 0 returns the first, 1 the second. */
export function interpolateColor(color1: string, color2: string, factor = 0.5): string {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(
    Math.round(c1.r + factor * (c2.r - c1.r)),
    Math.round(c1.g + factor * (c2.g - c1.g)),
    Math.round(c1.b + factor * (c2.b - c1.b))
  );
}

/** A 16-step ramp between two colours, matching visum's density scale. */
export function makePalette(from: string, to: string): string[] {
  return Array.from({ length: PALETTE_STEPS }, (_, i) =>
    interpolateColor(from, to, i / (PALETTE_STEPS - 1))
  );
}

/**
 * Picks the palette step for a count, ramping linearly across the range the
 * populated cells actually span — visum's `valueToFillIndex`. Scaling from the
 * quietest cell rather than from zero uses the whole ramp on a grid whose
 * counts are all large.
 */
export function paletteIndex(count: number, minCount: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) {
    return 0;
  }
  const range = maxCount - minCount;
  if (range === 0) {
    return 0;
  }
  return Math.min(PALETTE_STEPS - 1, Math.floor((PALETTE_STEPS * (count - minCount)) / range));
}

// Tick increments that land on whole seconds, minutes and hours rather than
// arbitrary offsets. Ported from visum.
const X_TICK_INCRS_MS = [
  1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000,
  7200000, 10800000, 21600000, 43200000, 86400000,
];

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clock time down to the second, for windows a minute or shorter. */
export function formatClockSeconds(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`;
}

export interface AxisTick {
  /** Position across the axis, 0–100. */
  pct: number;
  label: string;
}

/**
 * Time ticks across the grid, aligned to a round increment so labels read as
 * clock times. Returns at most `target` ticks.
 */
export function timeAxisTicks(startMs: number, endMs: number, target = 6): AxisTick[] {
  const span = endMs - startMs;
  if (!(span > 0)) {
    return [];
  }

  const rough = span / target;
  const increment = X_TICK_INCRS_MS.find((i) => i >= rough) ?? X_TICK_INCRS_MS[X_TICK_INCRS_MS.length - 1];

  const times: number[] = [];
  // Start at the first round boundary at or after the range start.
  for (let t = Math.ceil(startMs / increment) * increment; t <= endMs; t += increment) {
    times.push(t);
  }

  // Show HH:MM; fall back to HH:MM:SS only when a sub-minute step would
  // otherwise render the same label twice, which locates nothing.
  const labels = times.map(formatClock);
  const format = new Set(labels).size === labels.length ? formatClock : formatClockSeconds;

  return times.map((t) => ({ pct: ((t - startMs) / span) * 100, label: format(t) }));
}

export interface DurationTick extends AxisTick {
  /** The duration the tick sits at, in microseconds. */
  micros: number;
}

/**
 * Duration labels up the heatmap's band axis.
 *
 * The bands are log-spaced, so a duration between two edges is interpolated in
 * log space. Five labels, as visum: one per band is unreadable at sixteen
 * bands, and the bands themselves already show where a value sits.
 */
export function durationAxisTicks(edgesNs: readonly number[], count = 5): DurationTick[] {
  if (edgesNs.length === 0 || count < 1) {
    return [];
  }

  const logs = edgesNs.map((ns) => Math.log(Math.max(ns / 1000, 1e-9)));
  const last = logs.length - 1;

  return Array.from({ length: count }, (_, i) => {
    const fraction = count === 1 ? 0 : i / (count - 1);
    const position = fraction * last;
    const lower = Math.max(0, Math.min(Math.floor(position), last - 1));
    const micros = Math.exp(logs[lower] + (position - lower) * ((logs[lower + 1] ?? logs[lower]) - logs[lower]));
    return { pct: fraction * 100, micros, label: formatMicros(micros) };
  });
}
