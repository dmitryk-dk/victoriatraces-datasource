import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Tooltip, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { TraceListRow } from '../api/traceList';
import { formatMicros } from '../utils/format';
import type { ChartSelection } from './heatmapGrid';
import { horizontalTickStyle, verticalTickStyle } from './axisPlacement';
import { timeAxisTicks } from './heatmapScale';
import {
  bubbleDiameter,
  durationExtent,
  durationTicks,
  pointPosition,
  rectToSelection,
  selectionToRect,
  type ScatterGeometry,
} from './scatterGeometry';
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

/** Floor for the plot: below this the dots smear into one line. */
const MIN_PLOT_HEIGHT = 160;
/** Room for a humanized duration ("100.00ms") without wrapping. */
const AXIS_WIDTH = 56;

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
  rows: TraceListRow[];
  startMs: number;
  endMs: number;
  /** Size of the sample these rows were drawn from, when it is known. */
  total?: number;
  /** The sample hit its limit, so this is not the whole range. */
  truncated?: boolean;
  onSelect?: (row: TraceListRow) => void;
  selectedTraceId?: string;
  /** The time × duration window, shared with the heatmap. */
  selection?: ChartSelection | null;
  onSelectionChange?: (selection: ChartSelection | null) => void;
  /** Commit the selection as the view: time range plus duration bounds. */
  onZoom?: (selection: ChartSelection) => void;
}

/**
 * Duration against start time, one bubble per trace, sized by span count.
 *
 * The y axis is logarithmic because trace durations are heavy-tailed and a
 * linear axis collapses the fast majority onto the baseline. Dragging draws
 * the same selection the heatmap uses, so a box drawn on either chart shows on
 * both; "Zoom in" commits it as the actual view.
 */
export function TracesScatterPlot({
  rows,
  startMs,
  endMs,
  total,
  truncated,
  onSelect,
  selectedTraceId,
  selection,
  onSelectionChange,
  onZoom,
}: Props) {
  const styles = useStyles2(getStyles);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const extent = useMemo(() => durationExtent(rows), [rows]);
  // Axis labels: round durations up the log scale, clock times across.
  const yTicks = useMemo(() => durationTicks(extent.minMicros, extent.maxMicros), [extent]);
  const xTicks = useMemo(() => timeAxisTicks(startMs, endMs, 5), [startMs, endMs]);

  const geometry = useCallback(
    (width: number, height: number): ScatterGeometry => ({
      width,
      height,
      startMs,
      endMs,
      minMicros: extent.minMicros,
      maxMicros: extent.maxMicros,
    }),
    [startMs, endMs, extent]
  );

  // Percentage space, so a point keeps its place when the panel is resized.
  const points = useMemo(() => {
    const geom = geometry(100, 100);
    return rows.map((row) => {
      const { x, y } = pointPosition(Date.parse(row.startTime), row.durationMicros, geom);
      return { row, left: x, top: y, size: bubbleDiameter(row.spans) };
    });
  }, [rows, geometry]);

  const plotBox = () => plotRef.current?.getBoundingClientRect();

  const pointerAt = (e: React.PointerEvent, box: DOMRect) => ({
    x: Math.min(box.width, Math.max(0, e.clientX - box.left)),
    y: Math.min(box.height, Math.max(0, e.clientY - box.top)),
  });

  const committedRect = (box: DOMRect): PxRect | null =>
    selection ? selectionToRect(selection, geometry(box.width, box.height)) : null;

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

    const rect =
      current.mode === 'new'
        ? normalizeRect({ x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 })
        : current.rect;

    // A click belongs to the dot under it, which has its own handler; only a
    // real drag draws a window.
    if (current.mode === 'new' && isClick(rect)) {
      return;
    }
    onSelectionChange(rectToSelection(rect, geometry(box.width, box.height)));
  };

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

  if (points.length === 0) {
    return <div className={styles.empty}>No traces in this range.</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.chartRow}>
        <div className={styles.axis}>
          {yTicks.map((tick) => (
            <span
              key={tick.pct}
              className={styles.axisLabel}
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
          aria-label="Trace duration over time"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {points.map(({ row, left, top, size }) => (
            <Tooltip
              key={row.traceID}
              content={
                <span>
                  {row.rootService}: {row.rootOperation} · {formatMicros(row.durationMicros)} ·{' '}
                  {row.spans} {row.spans === 1 ? 'span' : 'spans'}
                  {row.errors > 0 ? ` · ${row.errors} errors` : ''}
                </span>
              }
            >
              <button
                type="button"
                aria-label={`Trace ${row.traceID}`}
                onClick={() => onSelect?.(row)}
                className={row.errors > 0 ? styles.dotError : styles.dot}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: size,
                  height: size,
                  ...(row.traceID === selectedTraceId ? { outline: '2px solid currentColor' } : {}),
                }}
              />
            </Tooltip>
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

      <div className={styles.timeAxis}>
        {xTicks.map((tick) => (
          <span
            key={tick.pct}
            className={styles.timeLabel}
            data-testid="time-tick"
            style={horizontalTickStyle(tick.pct)}
          >
            {tick.label}
          </span>
        ))}
      </div>

      <div className={styles.legend}>
          <span>Bubble size · span count</span>
          {total !== undefined && total > 0 ? (
            <span>
              {points.length} of {total} traces
            </span>
          ) : (
            truncated && <span>{points.length} traces (sampled)</span>
          )}
          {selection && onZoom && (
            <Button size="sm" variant="secondary" fill="text" onClick={() => onZoom(selection)}>
              Zoom in
            </Button>
          )}
          {selection && onSelectionChange && (
            <Button size="sm" variant="secondary" fill="text" onClick={() => onSelectionChange(null)}>
              Clear selection
            </Button>
        )}
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    // Fill whatever the panel offers, down to a floor where dots still read.
    flex: 1,
    minHeight: MIN_PLOT_HEIGHT,
  }),
  chartRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    // The axis and the plot stretch to one another, so a label always sits at
    // the height of the duration it names however tall the panel is.
    flex: 1,
    minHeight: 0,
  }),
  axisLabel: css({
    position: 'absolute',
    right: 0,
    transform: 'translateY(50%)',
    color: theme.colors.text.secondary,
    fontSize: 10,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }),
  timeAxis: css({
    position: 'relative',
    height: theme.spacing(2),
    // Cleared past the duration labels so a clock time sits under its column.
    marginLeft: AXIS_WIDTH + 8,
  }),
  timeLabel: css({
    position: 'absolute',
    transform: 'translateX(-50%)',
    color: theme.colors.text.secondary,
    fontSize: 10,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }),
  axis: css({
    position: 'relative',
    width: AXIS_WIDTH,
    flexShrink: 0,
  }),
  plotColumn: css({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    gap: theme.spacing(0.5),
  }),
  plot: css({
    position: 'relative',
    flex: 1,
    minWidth: 0,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'crosshair',
    touchAction: 'none',
  }),
  dot: css({
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    background: theme.visualization.getColorByName('blue'),
    opacity: 0.7,
    '&:hover': { opacity: 1 },
  }),
  dotError: css({
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    background: theme.visualization.getColorByName('red'),
    opacity: 0.8,
    '&:hover': { opacity: 1 },
  }),
  selection: css({
    position: 'absolute',
    pointerEvents: 'none',
    border: `1px solid ${theme.colors.primary.border}`,
    background: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
  }),
  legend: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  empty: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
