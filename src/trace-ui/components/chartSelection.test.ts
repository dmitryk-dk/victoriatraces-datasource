import {
  hitTest,
  isClick,
  moveRect,
  normalizeRect,
  resizeRect,
  type PxRect,
} from './chartSelection';

const rect = (x1: number, y1: number, x2: number, y2: number): PxRect => ({ x1, y1, x2, y2 });

describe('normalizeRect', () => {
  it('orders the corners of a rectangle dragged up and to the left', () => {
    expect(normalizeRect(rect(80, 60, 20, 10))).toEqual(rect(20, 10, 80, 60));
  });

  it('leaves an already-ordered rectangle alone', () => {
    expect(normalizeRect(rect(20, 10, 80, 60))).toEqual(rect(20, 10, 80, 60));
  });
});

describe('isClick', () => {
  it('treats a drag shorter than the threshold as a click', () => {
    expect(isClick(rect(20, 10, 22, 12))).toBe(true);
  });

  it('treats a wide drag as a selection', () => {
    expect(isClick(rect(20, 10, 60, 12))).toBe(false);
  });

  it('treats a tall drag as a selection', () => {
    expect(isClick(rect(20, 10, 22, 50))).toBe(false);
  });
});

describe('hitTest', () => {
  const committed = rect(20, 20, 80, 60);

  it('finds nothing when no selection is committed', () => {
    expect(hitTest(50, 40, null)).toEqual({ kind: 'none' });
  });

  it('reports a move inside the box', () => {
    expect(hitTest(50, 40, committed)).toEqual({ kind: 'move' });
  });

  it('reports nothing outside the box', () => {
    expect(hitTest(120, 40, committed)).toEqual({ kind: 'none' });
  });

  it('reports each edge as its own handle', () => {
    expect(hitTest(50, 20, committed)).toEqual({ kind: 'resize', handle: 'n' });
    expect(hitTest(50, 60, committed)).toEqual({ kind: 'resize', handle: 's' });
    expect(hitTest(20, 40, committed)).toEqual({ kind: 'resize', handle: 'w' });
    expect(hitTest(80, 40, committed)).toEqual({ kind: 'resize', handle: 'e' });
  });

  it('prefers the corner where two edges meet', () => {
    expect(hitTest(20, 20, committed)).toEqual({ kind: 'resize', handle: 'nw' });
    expect(hitTest(80, 60, committed)).toEqual({ kind: 'resize', handle: 'se' });
    expect(hitTest(80, 20, committed)).toEqual({ kind: 'resize', handle: 'ne' });
    expect(hitTest(20, 60, committed)).toEqual({ kind: 'resize', handle: 'sw' });
  });

  it('grabs a handle from just outside the edge, within tolerance', () => {
    expect(hitTest(50, 17, committed)).toEqual({ kind: 'resize', handle: 'n' });
  });
});

describe('moveRect', () => {
  it('shifts the box by the drag delta', () => {
    expect(moveRect(rect(20, 20, 80, 60), 10, 5, 200, 100)).toEqual(rect(30, 25, 90, 65));
  });

  it('stops at the left and top edges instead of leaving the plot', () => {
    expect(moveRect(rect(20, 20, 80, 60), -50, -50, 200, 100)).toEqual(rect(0, 0, 60, 40));
  });

  it('stops at the right and bottom edges', () => {
    expect(moveRect(rect(20, 20, 80, 60), 500, 500, 200, 100)).toEqual(rect(140, 60, 200, 100));
  });

  it('keeps the box the same size while moving', () => {
    const moved = moveRect(rect(20, 20, 80, 60), 33, -7, 200, 100);
    expect(moved.x2 - moved.x1).toBe(60);
    expect(moved.y2 - moved.y1).toBe(40);
  });
});

describe('resizeRect', () => {
  const base = rect(20, 20, 80, 60);

  it('moves only the dragged edge', () => {
    expect(resizeRect(base, 'e', 120, 999)).toEqual(rect(20, 20, 120, 60));
    expect(resizeRect(base, 'w', 5, 999)).toEqual(rect(5, 20, 80, 60));
    expect(resizeRect(base, 'n', 999, 5)).toEqual(rect(20, 5, 80, 60));
    expect(resizeRect(base, 's', 999, 90)).toEqual(rect(20, 20, 80, 90));
  });

  it('moves both edges of a corner', () => {
    expect(resizeRect(base, 'se', 120, 90)).toEqual(rect(20, 20, 120, 90));
    expect(resizeRect(base, 'nw', 5, 5)).toEqual(rect(5, 5, 80, 60));
  });

  it('reorders the corners when an edge is dragged past its opposite', () => {
    expect(resizeRect(base, 'e', 10, 999)).toEqual(rect(10, 20, 20, 60));
  });
});
