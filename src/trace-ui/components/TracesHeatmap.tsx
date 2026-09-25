import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Tooltip, useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { HeatmapData } from '../api/traceList';
import { verticalTickStyle } from './axisPlacement';
import { durationAxisTicks, makePalette, paletteIndex, PALETTE_STEPS, timeAxisTicks } from './heatmapScale';
import {
  binBounds,
  cellAt,
  heatmapRows,
  rectToSelection,
  selectionToRect,
  type ChartSelection,
  type HeatmapGeometry,
} from './heatmapGrid';
import {
  hitTest,
  isClick,
  moveRect,
  normalizeRect,
  resizeRect,
  RESIZE_CURSOR,
  type Handle,
  type PxRect,
} from './chartSelection';

// The whole grid is this tall whatever the bin count: every
// duration band is drawn, and at a fixed row height sixteen of them would push
// the trace list out of a panel's viewport.
/** Floor for the grid: below this the bands are thinner than a pixel each. */
const MIN_PLOT_HEIGHT = 120;
const LABEL_WIDTH = 76;

/** Clicking a legend entry shows only that kind; clicking it again restores both. */
type IsolatedKind = 'errors' | 'ok' | null;

/** An in-progress pointer gesture. Pixel space, against the plot's own box. */
interface DragBase {
  /** The plot's pixel size when the gesture began, to draw the draft box by. */
  size: { width: number; height: number };
}

type Drag = DragBase &
  (
    | { mode: 'new'; x1: number; y1: number; x2: number; y2: number }
    | { mode: 'move'; startX: number; startY: number; base: PxRect; rect: PxRect }
    | { mode: 'resize'; handle: Handle; base: PxRect; rect: PxRect }
  );

interface Props {
  data: HeatmapData;
  /** Drill into a duration band. Bounds are microseconds; undefined is open-ended. */
  /** The committed time × duration window, shared with the scatter plot. */
  selection?: ChartSelection | null;
  onSelectionChange?: (selection: ChartSelection | null) => void;
}

/**
 * Trace volume over time, banded by duration. Rows are the duration bins the
 * backend counted into; columns are time buckets.
 *
 * Every bin is drawn, empty ones included: the height a duration sits at is
 * what makes two renders comparable, and hiding empty bands moves the rest.
 *
 * Dragging selects a time × duration window, which the caller uses to drill the
 * trace list; a plain click drills the single cell under the pointer, so the
 * drilled result matches the count in the tooltip. A committed box can be
 * dragged around and resized from its edges.
 */
export function TracesHeatmap({ data, selection, onSelectionChange }: Props) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [isolated, setIsolated] = useState<IsolatedKind>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Two ramps so an error cell is distinguishable from a busy healthy one at
  // the same density. Endpoints come from the theme, not fixed hex.
  const { okPalette, errorPalette } = useMemo(
    () => ({
      okPalette: makePalette(theme.colors.background.secondary, theme.visualization.getColorByName('blue')),
      errorPalette: makePalette(theme.colors.background.secondary, theme.visualization.getColorByName('red')),
    }),
    [theme]
  );

  const cells = useMemo(() => data?.cells ?? [], [data]);
  const edgesNs = useMemo(() => data?.yEdgesNs ?? [], [data]);
  const yBins = edgesNs.length + 1;
  const xCount = Math.max(data?.xCount ?? 0, 0);

  const { rows, maxCount } = useMemo(() => heatmapRows(cells, yBins), [cells, yBins]);

  // Five labels up the band axis: one per band is unreadable.
  const durationTicks = useMemo(() => durationAxisTicks(edgesNs), [edgesNs]);

  const ticks = useMemo(
    () => timeAxisTicks(data?.startMs ?? 0, (data?.startMs ?? 0) + xCount * (data?.stepMs ?? 0)),
    [data, xCount]
  );

  /** Geometry in the given units — pixels for hit testing, percent for drawing. */
  const geometry = useCallback(
    (width: number, height: number): HeatmapGeometry => ({
      width,
      height,
      xCount,
      yBins,
      startMs: data?.startMs ?? 0,
      stepMs: data?.stepMs ?? 0,
      edgesNs,
    }),
    [data, edgesNs, xCount, yBins]
  );

  const plotBox = () => plotRef.current?.getBoundingClientRect();

  const pointerAt = (e: React.PointerEvent, box: DOMRect) => ({
    x: Math.min(box.width, Math.max(0, e.clientX - box.left)),
    y: Math.min(box.height, Math.max(0, e.clientY - box.top)),
  });

  /** The committed selection in pixel space, for hit testing against. */
  const committedRect = (box: DOMRect): PxRect | null =>
    selection ? selectionToRect(selection, geometry(box.width, box.height)) : null;

  const emit = (rect: PxRect, box: DOMRect) => {
    onSelectionChange?.(rectToSelection(rect, geometry(box.width, box.height)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSelectionChange || e.button !== 0) {
      return;
    }
    const box = plotBox();
    if (!box || box.width === 0) {
      return;
    }
    const { x, y } = pointerAt(e, box);
    const size = { width: box.width, height: box.height };
    const committed = committedRect(box);
    const hit = hitTest(x, y, committed);

    if (hit.kind === 'resize' && committed) {
      setDrag({ mode: 'resize', handle: hit.handle, base: committed, rect: committed, size });
    } else if (hit.kind === 'move' && committed) {
      setDrag({ mode: 'move', startX: x, startY: y, base: committed, rect: committed, size });
    } else {
      setDrag({ mode: 'new', x1: x, y1: y, x2: x, y2: y, size });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = plotBox();
    if (!box || box.width === 0) {
      return;
    }
    const { x, y } = pointerAt(e, box);

    if (!drag) {
      // Cursor advertises what a press would do here.
      const hit = hitTest(x, y, committedRect(box));
      e.currentTarget.style.cursor =
        hit.kind === 'resize' ? RESIZE_CURSOR[hit.handle] : hit.kind === 'move' ? 'move' : 'crosshair';
      return;
    }

    if (drag.mode === 'new') {
      setDrag({ ...drag, x2: x, y2: y });
    } else if (drag.mode === 'move') {
      setDrag({ ...drag, rect: moveRect(drag.base, x - drag.startX, y - drag.startY, box.width, box.height) });
    } else {
      setDrag({ ...drag, rect: resizeRect(drag.base, drag.handle, x, y) });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = plotBox();
    const current = drag;
    setDrag(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!current || !box || box.width === 0 || !onSelectionChange) {
      return;
    }

    if (current.mode !== 'new') {
      emit(current.rect, box);
      return;
    }

    const rect = normalizeRect({ x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 });
    if (!isClick(rect)) {
      emit(rect, box);
      return;
    }

    // A click drills exactly the cell under the pointer, so the drilled rows
    // match its tooltip; clicking empty space clears. An imprecise drag on a
    // sparse chart would otherwise span whole empty bands.
    const geom = geometry(box.width, box.height);
    const { xi, yi } = cellAt(rect.x1, rect.y1, geom);
    const populated = cells.some((c) => c.xi === xi && c.yi === yi);
    if (!populated) {
      onSelectionChange(null);
      return;
    }
    const bounds = binBounds(yi, edgesNs);
    onSelectionChange({
      startMicros: (geom.startMs + xi * geom.stepMs) * 1000,
      endMicros: (geom.startMs + (xi + 1) * geom.stepMs) * 1000,
      minDurationMicros: bounds.minMicros,
      maxDurationMicros: bounds.maxMicros,
    });
  };

  const toggleKind = (kind: 'errors' | 'ok') => setIsolated((prev) => (prev === kind ? null : kind));

  // Drawn in percentages so the box survives a resize without re-measuring.
  const draftPct = useMemo(() => {
    if (!drag) {
      return null;
    }
    const { width, height } = drag.size;
    const rect =
      drag.mode === 'new'
        ? normalizeRect({ x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 })
        : drag.rect;
    return {
      x1: (rect.x1 / width) * 100,
      y1: (rect.y1 / height) * 100,
      x2: (rect.x2 / width) * 100,
      y2: (rect.y2 / height) * 100,
    };
  }, [drag]);

  const selectionPct = useMemo(
    () => (selection ? selectionToRect(selection, geometry(100, 100)) : null),
    [selection, geometry]
  );

  const box = draftPct ?? selectionPct;
  // Bands share the fixed height; a gap between rows would round differently
  // per band, so the rows are sized in percentages of the plot instead.
  const rowHeightPct = rows.length > 0 ? 100 / rows.length : 100;

  if (cells.length === 0) {
    return <div className={styles.empty}>No traces in this range.</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <div className={styles.labels}>
          {durationTicks.map((tick) => (
            <span
              key={tick.pct}
              className={styles.label}
              data-testid="duration-tick"
              data-micros={tick.micros}
              style={verticalTickStyle(tick.pct)}
            >
              {tick.label}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className={styles.plot}
          aria-label="Trace volume by duration"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {rows.map(({ yi, cells: rowCells }) => (
            <div
              key={yi}
              className={styles.row}
              data-testid="band-row"
              style={{ height: `${rowHeightPct}%` }}
            >
              {Array.from({ length: xCount }, (_, xi) => {
                const cell = rowCells.get(xi);
                const isError = (cell?.errors ?? 0) > 0;
                // A legend selection dims the other kind rather than removing
                // it, so the grid keeps its shape while you isolate.
                const hidden = cell !== undefined && isolated !== null && (isolated === 'errors') !== isError;

                if (!cell || hidden) {
                  return <span key={xi} className={styles.cellEmpty} />;
                }

                const palette = isError ? errorPalette : okPalette;
                return (
                  <Tooltip
                    key={xi}
                    content={
                      <span>
                        {bucketTime(data, xi)} · {cell.count} {cell.count === 1 ? 'trace' : 'traces'}
                        {cell.errors > 0 ? `, ${cell.errors} with errors` : ''}
                      </span>
                    }
                  >
                    <span
                      className={styles.cell}
                      style={{ background: palette[paletteIndex(cell.count, maxCount)] }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          ))}

          {box && (
            <div
              className={styles.selection}
              aria-label="Selected window"
              style={{
                left: `${box.x1}%`,
                top: `${box.y1}%`,
                width: `${Math.max(box.x2 - box.x1, 0)}%`,
                height: `${Math.max(box.y2 - box.y1, 0)}%`,
              }}
            />
          )}
        </div>
      </div>

      <div className={styles.axis}>
        <span className={styles.axisSpacer} />
        <div className={styles.axisTrack}>
          {ticks.map((tick) => (
            <span key={tick.pct} className={styles.tick} style={{ left: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.legend}>
        <button
          type="button"
          className={isolated === 'ok' ? styles.legendItemMuted : styles.legendItem}
          onClick={() => toggleKind('errors')}
          aria-pressed={isolated === 'errors'}
          title={isolated === 'errors' ? 'Show all cells' : 'Show only error cells'}
        >
          <span className={styles.swatch} style={{ background: errorPalette[PALETTE_STEPS - 1] }} />
          Errors
        </button>

        <button
          type="button"
          className={isolated === 'errors' ? styles.legendItemMuted : styles.legendItem}
          onClick={() => toggleKind('ok')}
          aria-pressed={isolated === 'ok'}
          title={isolated === 'ok' ? 'Show all cells' : 'Show only OK cells'}
        >
          <span className={styles.swatch} style={{ background: okPalette[PALETTE_STEPS - 1] }} />
          OK
        </button>

        {selection && onSelectionChange && (
          <Button size="sm" variant="secondary" fill="text" onClick={() => onSelectionChange(null)}>
            Clear selection
          </Button>
        )}

        <span className={styles.scale}>
          <span>0</span>
          <span className={styles.gradient}>
            {okPalette.map((c, i) => (
              <span key={i} className={styles.gradientStep} style={{ background: c }} />
            ))}
          </span>
          <span>
            {maxCount} {maxCount === 1 ? 'trace' : 'traces'} (max)
          </span>
        </span>
      </div>
    </div>
  );
}

/** Upper bound of a duration bin, in the same words the rest of the UI uses. */

function bucketTime(data: HeatmapData, xi: number): string {
  return new Date(data.startMs + xi * data.stepMs).toLocaleTimeString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    // Take the panel's height: the charts have a panel to themselves now.
    flex: 1,
    minHeight: MIN_PLOT_HEIGHT,
  }),
  grid: css({
    display: 'flex',
    gap: theme.spacing(1),
    // The label column and the grid stretch to one another, so a label always
    // sits at the height of the band it names.
    flex: 1,
    minHeight: 0,
  }),
  labels: css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: LABEL_WIDTH,
    flexShrink: 0,
  }),
  row: css({
    display: 'flex',
    alignItems: 'stretch',
    gap: 1,
    minHeight: 0,
  }),
  label: css({
    position: 'absolute',
    right: 0,
    // The tick names the boundary, so its text is centred on that height.
    transform: 'translateY(50%)',
    textAlign: 'right',
    color: theme.colors.text.secondary,
    // The bands are short, so the labels are smaller than body text.
    fontSize: 10,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  }),
  plot: css({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
    cursor: 'crosshair',
    touchAction: 'none',
  }),
  cell: css({
    flex: 1,
    borderRadius: 1,
  }),
  cellEmpty: css({
    flex: 1,
    background: theme.colors.background.secondary,
    opacity: 0.4,
    borderRadius: 1,
  }),
  selection: css({
    position: 'absolute',
    pointerEvents: 'none',
    border: `1px solid ${theme.colors.primary.border}`,
    background: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
  }),
  axis: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: 2,
  }),
  axisSpacer: css({
    width: LABEL_WIDTH,
    flexShrink: 0,
  }),
  axisTrack: css({
    position: 'relative',
    flex: 1,
    height: 14,
  }),
  tick: css({
    position: 'absolute',
    top: 0,
    transform: 'translateX(-50%)',
    whiteSpace: 'nowrap',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
  legend: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    paddingLeft: LABEL_WIDTH + Number(theme.spacing(1).replace('px', '')),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  legendItem: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
    color: 'inherit',
    fontSize: 'inherit',
    '&:hover': { color: theme.colors.text.primary },
  }),
  legendItemMuted: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
    color: 'inherit',
    fontSize: 'inherit',
    opacity: 0.4,
    textDecoration: 'line-through',
  }),
  swatch: css({
    width: 10,
    height: 10,
  }),
  scale: css({
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontVariantNumeric: 'tabular-nums',
  }),
  gradient: css({
    display: 'flex',
    width: 80,
    height: 8,
    overflow: 'hidden',
    borderRadius: theme.shape.radius.default,
  }),
  gradientStep: css({
    flex: 1,
  }),
  empty: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
