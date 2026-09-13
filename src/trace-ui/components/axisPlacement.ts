import type { CSSProperties } from 'react';

/**
 * Where an axis label sits, given its position along the axis.
 *
 * A label is centred on its tick, which puts half of an end label outside the
 * plot: the topmost duration collides with whatever sits above the chart, and
 * the first clock time hangs off the left edge. The two ends are therefore
 * pinned inside instead of centred, as a plotting library would.
 */

/** Within this much of an end, a label is pinned rather than centred. */
const EDGE_PCT = 1;

/** Vertical placement for a tick `pct` up from the bottom of the axis. */
export function verticalTickStyle(pct: number): CSSProperties {
  if (pct >= 100 - EDGE_PCT) {
    return { top: 0, transform: 'none' };
  }
  if (pct <= EDGE_PCT) {
    return { bottom: 0, transform: 'none' };
  }
  return { bottom: `${pct}%` };
}

/** Horizontal placement for a tick `pct` across from the left of the axis. */
export function horizontalTickStyle(pct: number): CSSProperties {
  if (pct >= 100 - EDGE_PCT) {
    return { right: 0, transform: 'none' };
  }
  if (pct <= EDGE_PCT) {
    return { left: 0, transform: 'none' };
  }
  return { left: `${pct}%` };
}
