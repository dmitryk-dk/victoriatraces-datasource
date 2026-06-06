import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2, useTheme2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import {
  CartesianGrid,
  ReferenceArea,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ResponsiveContainer,
} from 'recharts';
import type { TraceSearchRow } from '../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';

interface TracesScatterPlotProps {
  rows: TraceSearchRow[];
  onTraceClick?: (traceId: string) => void;
}

interface PlotItem {
  x: number;
  y: number;
  z: number;
  traceID: string;
  rootServiceName: string;
  rootTraceName: string;
  errorCount: number;
}

interface ZoomArea {
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
  active: boolean;
}

const MIN_ZOOM_X = 100;   // 100ms
const MIN_ZOOM_Y = 0.1;   // 0.1ms

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    padding: `${theme.spacing(1)} 0`,
  }),
  dot: css({
    cursor: 'pointer',
  }),
  tooltip: css({
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: 'monospace',
    pointerEvents: 'none',
  }),
  tooltipRow: css({
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: 2,
  }),
  tooltipKey: css({ color: theme.colors.text.secondary }),
  tooltipVal: css({ fontWeight: 600 }),
});

function CustomTooltip({ active, payload }: any) {
  const styles = useStyles2(getStyles);
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as PlotItem;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Trace ID</span>
        <span className={styles.tooltipVal}>{d.traceID}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Service</span>
        <span className={styles.tooltipVal}>{d.rootServiceName}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Operation</span>
        <span className={styles.tooltipVal}>{d.rootTraceName}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Started</span>
        <span className={styles.tooltipVal}>{formatTimestampMs(d.x)}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Duration</span>
        <span className={styles.tooltipVal}>{formatDurationMs(d.y)}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Spans</span>
        <span className={styles.tooltipVal}>{d.z}</span>
      </div>
      {d.errorCount > 0 && (
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipKey}>Errors</span>
          <span className={styles.tooltipVal} style={{ color: 'red' }}>{d.errorCount}</span>
        </div>
      )}
    </div>
  );
}

export function TracesScatterPlot({ rows, onTraceClick }: TracesScatterPlotProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [filtered, setFiltered] = useState(rows);
  const [zoom, setZoom] = useState<ZoomArea>({ x1: null, y1: null, x2: null, y2: null, active: false });

  useEffect(() => {
    setFiltered(rows);
    setZoom({ x1: null, y1: null, x2: null, y2: null, active: false });
  }, [rows]);

  const data: PlotItem[] = useMemo(() =>
    filtered.map((r) => ({
      x: r.startTime,
      y: r.traceDuration,
      z: r.spanCount,
      traceID: r.traceID,
      rootServiceName: r.rootServiceName,
      rootTraceName: r.rootTraceName,
      errorCount: r.errorCount ?? 0,
    })),
    [filtered]
  );

  const dragRef = React.useRef(false);

  const handleMouseDown = useCallback((e: any) => {
    if (e?.xValue != null && e?.yValue != null) {
      dragRef.current = false;
      setZoom({ x1: e.xValue, y1: e.yValue, x2: e.xValue, y2: e.yValue, active: true });
    }
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (zoom.active && e?.xValue != null && e?.yValue != null) {
      dragRef.current = true;
      setZoom((z) => ({ ...z, x2: e.xValue, y2: e.yValue }));
    }
  }, [zoom.active]);

  const handleMouseUp = useCallback((e: any) => {
    if (!zoom.active || zoom.x1 == null || zoom.x2 == null || zoom.y1 == null || zoom.y2 == null) {
      setZoom((z) => ({ ...z, active: false }));
      return;
    }
    const xMin = Math.min(zoom.x1, zoom.x2);
    const xMax = Math.max(zoom.x1, zoom.x2);
    const yMin = Math.min(zoom.y1, zoom.y2);
    const yMax = Math.max(zoom.y1, zoom.y2);
    if (dragRef.current && (xMax - xMin) > MIN_ZOOM_X && (yMax - yMin) > MIN_ZOOM_Y) {
      setFiltered(rows.filter((r) => r.startTime >= xMin && r.startTime <= xMax && r.traceDuration >= yMin && r.traceDuration <= yMax));
    } else if (!dragRef.current) {
      // Click (not drag) — find clicked point via activePayload or nearest match
      let traceID: string | undefined;
      if (e?.activePayload?.length) {
        traceID = e.activePayload[0]?.payload?.traceID;
      }
      if (!traceID && e?.xValue != null && e?.yValue != null) {
        const xRange = Math.max(...data.map((d) => d.x)) - Math.min(...data.map((d) => d.x)) || 1;
        const yRange = Math.max(...data.map((d) => d.y)) - Math.min(...data.map((d) => d.y)) || 1;
        let minDist = Infinity;
        for (const item of data) {
          const dx = (item.x - e.xValue) / xRange;
          const dy = (item.y - e.yValue) / yRange;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) {
            minDist = dist;
            traceID = item.traceID;
          }
        }
        if (minDist > 0.005) {
          traceID = undefined;
        }
      }
      if (traceID) {
        onTraceClick?.(traceID);
      }
    }
    setZoom({ x1: null, y1: null, x2: null, y2: null, active: false });
  }, [zoom, rows, data, onTraceClick]);

  const hasZoomBox = zoom.active && zoom.x1 != null && zoom.x2 != null;
  const dotColor = theme.colors.primary.main;
  const dotErrorColor = theme.colors.error.main;

  const renderDot = useCallback((props: any) => {
    const { cx, cy, payload } = props;
    const hasError = payload?.errorCount > 0;
    return (
      <circle
        key={`dot-${payload?.traceID}`}
        cx={cx}
        cy={cy}
        r={6}
        fill={hasError ? dotErrorColor : dotColor}
        fillOpacity={0.7}
        stroke={hasError ? dotErrorColor : dotColor}
        strokeWidth={1}
        className={styles.dot}
      />
    );
  }, [dotColor, dotErrorColor, styles.dot]);

  return (
    <div className={styles.container}>
      {filtered.length < rows.length && (
        <button
          style={{ marginBottom: 8, cursor: 'pointer', fontSize: 12 }}
          onClick={() => setFiltered(rows)}
        >
          ← Reset zoom ({rows.length} traces)
        </button>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart
          margin={{ top: 10, right: 20, bottom: 20, left: 20 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.border.weak} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['auto', 'auto']}
            name="Start Time"
            scale="time"
            tickFormatter={(v) => new Date(v).toLocaleTimeString()}
            tick={{ fontSize: 10, fontFamily: 'monospace' }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name="Duration"
            tickFormatter={(v) => formatDurationMs(v)}
            tick={{ fontSize: 10, fontFamily: 'monospace' }}
          />
          <ZAxis dataKey="z" range={[30, 300]} name="Spans" />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} shape={renderDot} />
          {hasZoomBox && zoom.x1 != null && zoom.x2 != null && zoom.y1 != null && zoom.y2 != null && (
            <ReferenceArea
              x1={Math.min(zoom.x1, zoom.x2)}
              x2={Math.max(zoom.x1, zoom.x2)}
              y1={Math.min(zoom.y1, zoom.y2)}
              y2={Math.max(zoom.y1, zoom.y2)}
              strokeOpacity={0.3}
              fill={theme.colors.primary.transparent}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
