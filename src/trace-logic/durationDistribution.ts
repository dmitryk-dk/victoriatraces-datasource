export type CellTone = 'green' | 'yellow' | 'red';

export interface HistogramCell {
  /** Duration bucket bounds (µs), quickest bucket first. */
  readonly fromMicros: number;
  readonly toMicros: number;
  /** Hits that landed in this bucket. */
  readonly count: number;
  readonly tone: CellTone;
  /** Density relative to the fullest bucket, 0..1 (0 = empty). */
  readonly intensity: number;
}

/** Linear-interpolated quantile of an ASCENDING array; p in [0, 1]. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {return 0;}
  const pos = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) {return sorted[lo];}
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Tone thresholds are RELATIVE to the MEDIAN duration — "how far from
// typical", not "how far from the single quickest sample" (one lucky fast
// outlier must not paint the normal case red). Typical-or-faster is green,
// moderately above typical is yellow, far above is red. The palette still
// adapts to the spread: identical durations → all green; a mild spread tops
// out at yellow; only a genuinely wide spread produces red cells.
const GREEN_MAX_RATIO = 1.5;
const YELLOW_MAX_RATIO = 4;

// Ratios alone are scale-blind: 3× a 10s median is 20 extra seconds of real
// waiting, while 3× a 30µs median is nothing. Severity therefore ALSO
// escalates on the absolute excess over the median, whatever the ratio says.
const YELLOW_MIN_EXCESS_MICROS = 1_000_000; // ≥1s slower than typical
const RED_MIN_EXCESS_MICROS = 5_000_000; // ≥5s slower than typical

// Duration distributions are heavy-tailed; past this spread the value axis
// switches to log so the fast cluster doesn't collapse into one bucket.
const LOG_AXIS_MIN_RATIO = 8;

function toneFor(valueMicros: number, baseMicros: number): CellTone {
  const excess = valueMicros - baseMicros;
  if (excess >= RED_MIN_EXCESS_MICROS) {return 'red';}
  const ratio = valueMicros / baseMicros;
  if (ratio > YELLOW_MAX_RATIO) {return 'red';}
  if (ratio > GREEN_MAX_RATIO || excess >= YELLOW_MIN_EXCESS_MICROS) {
    return 'yellow';
  }
  return 'green';
}

function isLogAxis(minMicros: number, maxMicros: number): boolean {
  return minMicros > 0 && maxMicros / minMicros > LOG_AXIS_MIN_RATIO;
}

/**
 * Position of a duration on the strip's value axis: 0 = quickest sample,
 * 1 = slowest. Uses the same (log or linear) axis as the histogram buckets so
 * the marker lines up with its bucket.
 */
export function valueFraction(
  sortedMicros: readonly number[],
  valueMicros: number,
): number {
  const n = sortedMicros.length;
  if (n === 0) {return 0;}
  const min = sortedMicros[0];
  const max = sortedMicros[n - 1];
  if (max === min) {return 0.5;}
  const f = isLogAxis(min, max)
    ? (Math.log(Math.max(valueMicros, min)) - Math.log(min)) /
      (Math.log(max) - Math.log(min))
    : (valueMicros - min) / (max - min);
  return Math.min(1, Math.max(0, f));
}

/**
 * Bucket the sorted duration sample along the value axis (quickest → slowest,
 * left → right). Each cell's tone reflects how slow the bucket is relative to
 * the quickest duration, and its intensity reflects how many hits landed
 * there — the density the strip visualizes.
 */
export function buildHistogramCells(
  sortedMicros: readonly number[],
  cellCount = 36,
): HistogramCell[] {
  const n = sortedMicros.length;
  if (n === 0) {return [];}
  const min = sortedMicros[0];
  const max = sortedMicros[n - 1];
  // Anchor the tone scale on the typical duration. A zero median (many
  // zero-duration spans) falls back to the smallest non-zero duration so
  // ratios stay finite (all-zero → all green).
  const median = quantile(sortedMicros, 0.5);
  const base = median > 0 ? median : (sortedMicros.find((v) => v > 0) ?? 1);

  // Degenerate sample (every duration identical): one full green cell.
  if (max === min) {
    return [
      {
        fromMicros: min,
        toMicros: max,
        count: n,
        tone: toneFor(min, base),
        intensity: 1,
      },
    ];
  }

  const counts = new Array<number>(cellCount).fill(0);
  for (const v of sortedMicros) {
    const idx = Math.min(
      cellCount - 1,
      Math.floor(valueFraction(sortedMicros, v) * cellCount),
    );
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);

  const log = isLogAxis(min, max);
  const boundAt = (f: number) =>
    log
      ? Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * f)
      : min + (max - min) * f;

  return counts.map((count, i) => {
    const from = boundAt(i / cellCount);
    const to = boundAt((i + 1) / cellCount);
    return {
      fromMicros: from,
      toMicros: to,
      count,
      tone: toneFor((from + to) / 2, base),
      // sqrt easing keeps sparse buckets visible next to the dominant one.
      intensity: count === 0 ? 0 : Math.sqrt(count / maxCount),
    };
  });
}
