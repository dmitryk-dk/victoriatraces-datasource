import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { TraceListRow } from '../api/traceList';
import { formatMicros, formatTimestampMicros } from '../utils/format';
import { ServiceChips } from './ServiceChips';
import { TraceIdCell } from './TraceIdCell';
import { ATTR_COLUMN_PREFIX, fieldFromAttrColumnKey } from '../filters/traceFields';
import { ALL_COLUMNS, defaultWidths, TraceColumn } from './traceColumns';

// Below this fraction a column is unreadable, so a drag cannot shrink it further.
const MIN_COLUMN_FRACTION = 0.06;

interface Props {
  rows: TraceListRow[];
  search?: string;
  /** Columns to show, in order. Defaults to all of them. */
  columns?: readonly TraceColumn[];
  /** The first page is still on its way. Ignored once there are rows to show. */
  loading?: boolean;
  /** The query failed. Takes precedence over every empty state. */
  error?: Error;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onPreviewRow?: (row: TraceListRow) => void;
  onOpenTrace?: (row: TraceListRow) => void;
  previewedTraceId?: string;
}

export function TraceList({
  rows,
  search = '',
  columns = ALL_COLUMNS,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onPreviewRow,
  onOpenTrace,
  previewedTraceId,
}: Props) {
  const styles = useStyles2(getStyles);

  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current?.();
        }
      },
      { root: scrollRef.current, rootMargin: '300px' }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // Widths are fractions so the table reflows with the panel. Only columns the
  // user has actually dragged are stored; the rest fall back to their defaults.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState(false);

  const effectiveWidths = useMemo(() => {
    const keys = columns.map((c) => c.key);
    const defaults = defaultWidths(keys);
    const merged = Object.fromEntries(keys.map((k) => [k, widths[k] ?? defaults[k]]));
    const total = keys.reduce((sum, k) => sum + merged[k], 0) || 1;
    return Object.fromEntries(keys.map((k) => [k, merged[k] / total]));
  }, [columns, widths]);

  // Dragging a divider trades width between the two adjacent columns, so the
  // table total never changes and no column can be squeezed out of existence.
  const startResize = useCallback(
    (e: React.MouseEvent, leftKey: string, rightKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      const totalPx = tableRef.current?.getBoundingClientRect().width ?? 0;
      if (!totalPx) {
        return;
      }

      const startX = e.clientX;
      const base = { ...effectiveWidths };
      const startLeft = base[leftKey];
      const startRight = base[rightKey];

      const onMove = (ev: MouseEvent) => {
        let delta = (ev.clientX - startX) / totalPx;
        delta = Math.max(-(startLeft - MIN_COLUMN_FRACTION), Math.min(startRight - MIN_COLUMN_FRACTION, delta));
        setWidths({ ...base, [leftKey]: startLeft + delta, [rightKey]: startRight - delta });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        setResizing(false);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      setResizing(true);
    },
    [effectiveWidths]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter(
      (r) =>
        r.traceID.toLowerCase().includes(q) ||
        r.rootOperation.toLowerCase().includes(q) ||
        r.services.some((s) => s.toLowerCase().includes(q))
    );
  }, [rows, search]);

  // Metric bars are relative to the largest value currently on screen.
  const { maxDuration, maxSpans, maxErrors } = useMemo(() => {
    let d = 0;
    let s = 0;
    let e = 0;
    for (const r of filteredRows) {
      d = Math.max(d, r.durationMicros);
      s = Math.max(s, r.spans);
      e = Math.max(e, r.errors);
    }
    return { maxDuration: d, maxSpans: s, maxErrors: e };
  }, [filteredRows]);

  const visible = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);

  if (rows.length === 0) {
    // Four distinct outcomes: a failure, a page still loading, a
    // range that holds nothing, and a search that matched nothing. Saying
    // "no match" for an empty range sends the user hunting a filter they
    // never set.
    if (error) {
      return <div className={styles.error}>Failed to load traces: {error.message}</div>;
    }
    if (loading) {
      return <div className={styles.empty}>Loading…</div>;
    }
    if (!search.trim()) {
      return <div className={styles.empty}>No traces in this time range.</div>;
    }
  }

  if (filteredRows.length === 0) {
    return <div className={styles.empty}>No traces match your search.</div>;
  }

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <table ref={tableRef} className={styles.table}>
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={col.key}
                className={col.numeric ? styles.thNumeric : styles.th}
                style={{ width: `${effectiveWidths[col.key] * 100}%` }}
              >
                {col.key === 'svcop' ? (
                  <span className={styles.svcopHeader}>
                    Service <Icon name="angle-right" size="sm" /> Operation
                  </span>
                ) : (
                  col.label
                )}

                {i < columns.length - 1 && (
                  <button
                    type="button"
                    aria-label={`Resize ${col.label} column`}
                    title="Drag to resize"
                    className={styles.resizeHandle}
                    onMouseDown={(e) => startResize(e, col.key, columns[i + 1].key)}
                  >
                    <span className={styles.resizeGrip} />
                  </button>
                )}
              </th>
            ))}
            {onOpenTrace && <th className={styles.thAction} />}
          </tr>
        </thead>

        <tbody className={resizing ? styles.tbodyInert : undefined}>
          {filteredRows.map((row) => {
            const startMicros = Date.parse(row.startTime) * 1000;
            return (
              <tr
                key={row.traceID}
                className={previewedTraceId === row.traceID ? styles.rowActive : styles.row}
                onClick={() => {
                  // Selecting text in a row should not also open the preview.
                  const selection = window.getSelection();
                  if (selection && !selection.isCollapsed && selection.toString().trim()) {
                    return;
                  }
                  onPreviewRow?.(row);
                }}
              >
                {visible.has('trace') && (
                  <td className={styles.traceCell}>
                    <TraceIdCell traceId={row.traceID} />
                  </td>
                )}

                {visible.has('svcop') && (
                  <td className={styles.svcop}>
                    <div className={styles.svcopInner}>
                      <span className={styles.operation}>
                        {row.rootOperation || (row.partial ? '(partial)' : '')}
                      </span>
                      <ServiceChips services={row.services} />
                    </div>
                    {row.partial && (
                      <Tooltip content="Partial trace — the root span is outside the selected time range, so service and operation are best-effort.">
                        <Icon name="exclamation-triangle" size="sm" className={styles.partialIcon} />
                      </Tooltip>
                    )}
                  </td>
                )}

                {visible.has('started') && <td className={styles.muted}>{formatTimestampMicros(startMicros)}</td>}

                {visible.has('duration') && (
                  <MetricCell value={row.durationMicros} max={maxDuration}>
                    {formatMicros(row.durationMicros)}
                  </MetricCell>
                )}

                {visible.has('spans') && (
                  <MetricCell value={row.spans} max={maxSpans} align="right">
                    {row.spans}
                  </MetricCell>
                )}

                {visible.has('errors') && (
                  <MetricCell value={row.errors} max={maxErrors} align="right" tone="error">
                    {row.errors}
                  </MetricCell>
                )}

                {visible.has('spanId') && (
                  <td className={styles.spanId} title={row.spanID}>
                    {row.spanID}
                  </td>
                )}

                {visible.has('kind') && <td className={styles.muted}>{spanKindLabel(row.kind)}</td>}

                {visible.has('status') && (
                  <td className={styles.muted}>
                    {row.statusCode === 2 ? (
                      <span className={styles.statusError}>Error</span>
                    ) : row.statusCode === 1 ? (
                      <span>OK</span>
                    ) : (
                      <span className={styles.statusUnset}>—</span>
                    )}
                  </td>
                )}

                {columns
                  .filter((c) => c.key.startsWith(ATTR_COLUMN_PREFIX))
                  .map((c) => {
                    const value = row.attrs?.[fieldFromAttrColumnKey(c.key)] ?? '';
                    return (
                      <td key={c.key} className={styles.attr}>
                        <span className={styles.attrValue} title={value}>
                          {value}
                        </span>
                      </td>
                    );
                  })}

                {onOpenTrace && (
                  <td className={styles.action}>
                    <IconButton
                      name="share-alt"
                      tooltip="Open full trace view"
                      aria-label="Open full trace view"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTrace(row);
                      }}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {hasMore && (
        <div ref={setSentinel} className={styles.sentinel}>
          {loadingMore ? 'Loading…' : null}
        </div>
      )}
    </div>
  );
}

// OTLP span kinds, which arrive as their numeric enum value.
const SPAN_KIND_LABELS: Record<string, string> = {
  '0': 'Unspecified',
  '1': 'Internal',
  '2': 'Server',
  '3': 'Client',
  '4': 'Producer',
  '5': 'Consumer',
};

function spanKindLabel(kind: string | undefined): string {
  if (!kind) {
    return '';
  }
  return SPAN_KIND_LABELS[kind] ?? kind;
}

interface MetricCellProps {
  value: number;
  max: number;
  children: React.ReactNode;
  align?: 'left' | 'right';
  tone?: 'neutral' | 'error';
}

/** A cell whose background bar encodes the value's share of the column max. */
function MetricCell({ value, max, children, align = 'left', tone = 'neutral' }: MetricCellProps) {
  const styles = useStyles2(getStyles);
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <td className={align === 'right' ? styles.metricCellRight : styles.metricCell}>
      <span
        aria-hidden="true"
        className={tone === 'error' ? styles.barError : styles.bar}
        style={{ width: `${pct}%` }}
      />
      <span className={styles.metricValue}>{children}</span>
    </td>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  scroll: css({
    minHeight: 0,
    flex: 1,
    overflow: 'auto',
  }),
  table: css({
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      textAlign: 'left',
      // Tighter than a default Grafana table: trace lists are scanned, so more
      // rows on screen matters more than roomy padding.
      padding: theme.spacing(0.5, 1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
  }),
  th: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.primary,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    userSelect: 'none',
  }),
  thNumeric: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.primary,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    textAlign: 'right',
  }),
  thAction: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    width: 40,
    background: theme.colors.background.primary,
  }),
  svcopHeader: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  resizeHandle: css({
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: 10,
    transform: 'translateX(50%)',
    border: 'none',
    background: 'transparent',
    cursor: 'col-resize',
    padding: 0,
  }),
  resizeGrip: css({
    width: 1,
    height: '50%',
    background: theme.colors.border.medium,
    transition: 'background-color 120ms, width 120ms, height 120ms',
    'button:hover > &': {
      width: 2,
      height: '70%',
      background: theme.colors.primary.border,
    },
  }),
  tbodyInert: css({
    pointerEvents: 'none',
  }),
  row: css({
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowActive: css({
    cursor: 'pointer',
    background: theme.colors.action.selected,
  }),
  traceCell: css({
    // The hover-expanded id needs to escape its cell.
    overflow: 'visible',
    position: 'relative',
  }),
  svcop: css({
    overflow: 'hidden',
    position: 'relative',
  }),
  svcopInner: css({
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  }),
  operation: css({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  partialIcon: css({
    position: 'absolute',
    top: theme.spacing(0.75),
    right: theme.spacing(0.5),
    color: theme.colors.warning.text,
  }),
  muted: css({
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  metricCell: css({
    position: 'relative',
    overflow: 'hidden',
    fontVariantNumeric: 'tabular-nums',
  }),
  metricCellRight: css({
    position: 'relative',
    overflow: 'hidden',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  }),
  bar: css({
    position: 'absolute',
    insetBlock: 0,
    left: 0,
    background: theme.colors.background.secondary,
  }),
  barError: css({
    position: 'absolute',
    insetBlock: 0,
    left: 0,
    background: theme.colors.error.transparent,
  }),
  metricValue: css({
    position: 'relative',
  }),
  spanId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 0,
  }),
  statusError: css({
    color: theme.colors.error.text,
  }),
  statusUnset: css({
    color: theme.colors.text.disabled,
  }),
  attr: css({
    overflow: 'hidden',
    color: theme.colors.text.secondary,
  }),
  attrValue: css({
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  action: css({
    textAlign: 'center',
  }),
  error: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.error.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  empty: css({
    padding: theme.spacing(4),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  sentinel: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(1.5),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
