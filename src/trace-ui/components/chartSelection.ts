/**
 * Geometry for the selection box the heatmap and the scatter plot share.
 *
 * Pixel-space only: each chart converts the box into a time and duration
 * window itself, because their axes differ (banded duration bins against a
 * continuous log scale).
 */

export interface PxRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type Hit = { kind: 'none' } | { kind: 'move' } | { kind: 'resize'; handle: Handle };

/** How close to an edge counts as grabbing its handle. */
const HANDLE_PX = 6;
/** A drag smaller than this in both axes was meant as a click. */
const CLICK_PX = 3;

export const RESIZE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Orders the corners, so a box dragged in any direction reads the same. */
export function normalizeRect(r: PxRect): PxRect {
  return {
    x1: Math.min(r.x1, r.x2),
    y1: Math.min(r.y1, r.y2),
    x2: Math.max(r.x1, r.x2),
    y2: Math.max(r.y1, r.y2),
  };
}

export function isClick(r: PxRect, clickPx = CLICK_PX): boolean {
  const n = normalizeRect(r);
  return n.x2 - n.x1 < clickPx && n.y2 - n.y1 < clickPx;
}

/**
 * What the pointer is over: a resize handle, the box itself, or open space.
 *
 * Handles win over the body, and corners over edges, so the box can still be
 * resized when it is small enough that its handles overlap its middle.
 */
export function hitTest(x: number, y: number, rect: PxRect | null, handlePx = HANDLE_PX): Hit {
  if (!rect) {
    return { kind: 'none' };
  }
  const r = normalizeRect(rect);
  const nearLeft = Math.abs(x - r.x1) <= handlePx;
  const nearRight = Math.abs(x - r.x2) <= handlePx;
  const nearTop = Math.abs(y - r.y1) <= handlePx;
  const nearBottom = Math.abs(y - r.y2) <= handlePx;
  const withinX = x >= r.x1 - handlePx && x <= r.x2 + handlePx;
  const withinY = y >= r.y1 - handlePx && y <= r.y2 + handlePx;

  if (withinX && withinY) {
    if (nearTop && nearLeft) {
      return { kind: 'resize', handle: 'nw' };
    }
    if (nearTop && nearRight) {
      return { kind: 'resize', handle: 'ne' };
    }
    if (nearBottom && nearLeft) {
      return { kind: 'resize', handle: 'sw' };
    }
    if (nearBottom && nearRight) {
      return { kind: 'resize', handle: 'se' };
    }
    if (nearTop) {
      return { kind: 'resize', handle: 'n' };
    }
    if (nearBottom) {
      return { kind: 'resize', handle: 's' };
    }
    if (nearLeft) {
      return { kind: 'resize', handle: 'w' };
    }
    if (nearRight) {
      return { kind: 'resize', handle: 'e' };
    }
  }
  if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
    return { kind: 'move' };
  }
  return { kind: 'none' };
}

/** Slides the box by a drag delta, keeping its size and staying in the plot. */
export function moveRect(
  base: PxRect,
  dx: number,
  dy: number,
  width: number,
  height: number
): PxRect {
  const r = normalizeRect(base);
  const w = r.x2 - r.x1;
  const h = r.y2 - r.y1;
  const x1 = clamp(r.x1 + dx, 0, Math.max(0, width - w));
  const y1 = clamp(r.y1 + dy, 0, Math.max(0, height - h));
  return { x1, y1, x2: x1 + w, y2: y1 + h };
}

/** Drags one edge or corner to the pointer, leaving the others where they are. */
export function resizeRect(base: PxRect, handle: Handle, x: number, y: number): PxRect {
  const r = { ...normalizeRect(base) };
  if (handle.includes('w')) {
    r.x1 = x;
  }
  if (handle.includes('e')) {
    r.x2 = x;
  }
  if (handle.includes('n')) {
    r.y1 = y;
  }
  if (handle.includes('s')) {
    r.y2 = y;
  }
  return normalizeRect(r);
}
