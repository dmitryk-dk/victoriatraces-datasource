import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Checkbox, Icon, Input, MultiSelect, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import type { FlatSpanNode, Trace, TraceSpan } from '../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';
import { TimelineRuler } from './TimelineRuler';
import { SpanDuration, colorForService } from './SpanDuration';
import { buildChildrenByParent, findRootSpans, isErrorSpan } from '../../trace-logic/spanTree';
import {
  EMPTY_SPAN_FILTER,
  filterSpans,
  isSpanFilterActive,
  traceServices,
  type SpanFilter,
} from '../../trace-logic/spanFilter';
import { useVirtualizer } from '@tanstack/react-virtual';
import { computeCriticalPath, heaviestCriticalSpanId } from '../../trace-logic/criticalPath';
import { SpanTable } from './SpanTable';

export type TraceView = 'waterfall' | 'table';

const TRACE_VIEW_STORAGE_KEY = 'victoriatraces.traceView';

/** The waterfall/table choice is a display preference, remembered per browser. */
function readStoredTraceView(): TraceView {
  try {
    return localStorage.getItem(TRACE_VIEW_STORAGE_KEY) === 'table' ? 'table' : 'waterfall';
  } catch {
    return 'waterfall';
  }
}

function writeStoredTraceView(view: TraceView): void {
  try {
    localStorage.setItem(TRACE_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage disabled; the choice just will not survive a reload.
  }
}

interface TraceSpanTreeProps {
  trace: Trace;
  selectedSpanId?: string;
  onSelectSpan?: (spanId: string) => void;
}

const INDENT_PX = 16;

// Every row is a single line, so the list can be sized without measuring.
const ROW_HEIGHT_PX = 28;

// Assumed viewport height before the scroll element reports its own.
const INITIAL_VIEWPORT_PX = 800;

export function buildFlatTree(
  spans: TraceSpan[],
  expandedIds: Set<string>,
  traceID: string
): FlatSpanNode[] {
  const byId = new Map(spans.map((s) => [s.spanID, s]));
  const childIdsByParent = buildChildrenByParent(spans, traceID);
  const roots = findRootSpans(spans);

  const result: FlatSpanNode[] = [];

  function push(span: TraceSpan, depth: number) {
    const childIds = childIdsByParent.get(span.spanID) ?? [];
    const hasChildren = childIds.length > 0;
    const isExpanded = expandedIds.has(span.spanID);
    result.push({ span, depth, hasChildren, isExpanded });
    if (hasChildren && isExpanded) {
      for (const id of childIds) {
        const child = byId.get(id);
        if (child) {
          push(child, depth + 1);
        }
      }
    }
  }

  // Several roots only happen in partial traces; show the earliest first.
  for (const root of [...roots].sort((a, b) => a.startTime - b.startTime)) {
    push(root, 0);
  }

  return result;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    height: '100%',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body.fontSize,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }),
  header: css({
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  headerTitle: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(0.5),
  }),
  headerMeta: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginBottom: theme.spacing(1),
  }),
  badge: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.pill,
    padding: `0 ${theme.spacing(1)}`,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: '20px',
  }),
  errorBadge: css({
    background: theme.colors.error.transparent,
    border: `1px solid ${theme.colors.error.border}`,
    borderRadius: theme.shape.radius.pill,
    padding: `0 ${theme.spacing(1)}`,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: '20px',
    color: theme.colors.error.text,
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),
  actionBtnActive: css({
    cursor: 'pointer',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: `1px solid ${theme.colors.primary.border}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.primary.transparent,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  actionBtn: css({
    cursor: 'pointer',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': { background: theme.colors.action.hover },
  }),
  tableHeader: css({
    display: 'grid',
    gridTemplateColumns: '40% 60%',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    padding: `0 ${theme.spacing(1)}`,
  }),
  tableHeaderCell: css({
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }),
  rowsWrap: css({
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '40% 60%',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
    '&:last-child': { borderBottom: 'none' },
  }),
  filterBar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  filterCount: css({
    marginLeft: 'auto',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
  emptyFilter: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  criticalBadge: css({
    marginLeft: theme.spacing(0.5),
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    color: theme.colors.warning.text,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap',
  }),
  rowSelected: css({
    background: `${theme.colors.primary.transparent} !important`,
  }),
  rowLeft: css({
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'hidden',
    minWidth: 0,
  }),
  rowRight: css({
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
  }),
  spanName: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'hidden',
    minWidth: 0,
    fontFamily: 'monospace',
    fontSize: 12,
  }),
  serviceName: css({
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  opName: css({
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  arrow: css({
    color: theme.colors.text.disabled,
    flexShrink: 0,
  }),
  expandIcon: css({
    flexShrink: 0,
    cursor: 'pointer',
    color: theme.colors.text.secondary,
  }),
  leafIcon: css({
    flexShrink: 0,
    width: 14,
    display: 'inline-block',
  }),
  serviceDot: css({
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 4,
    boxShadow: `0 0 0 1px ${theme.colors.background.primary}`,
  }),
  errorSpan: css({
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 10,
    padding: '0 6px',
    borderRadius: 10,
    background: theme.colors.error.transparent,
    border: `1px solid ${theme.colors.error.border}`,
    color: theme.colors.error.text,
    flexShrink: 0,
  }),
  traceId: css({
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.colors.text.primary,
  }),
});

export function TraceSpanTree({ trace, selectedSpanId, onSelectSpan }: TraceSpanTreeProps) {
  const styles = useStyles2(getStyles);
  const { spans, processes, traceID } = trace;
  
  const rootSpan = findRootSpans(spans).sort((a, b) => a.startTime - b.startTime)[0];
  const traceMinMs = Math.min(...spans.map((s) => s.startTime));
  const traceMaxMs = Math.max(...spans.map((s) => s.startTime + s.duration));
  const totalDurationMs = traceMaxMs - traceMinMs;
  const errorCount = spans.filter((s) => isErrorSpan(s.tags)).length;

  const allSpanIds = useMemo(() => spans.map((s) => s.spanID), [spans]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(allSpanIds));
  const [filter, setFilter] = useState<SpanFilter>(EMPTY_SPAN_FILTER);

  // The panel keeps one tree mounted across traces, so expansion state has to
  // follow the spans on screen: ids from the previous trace would leave the
  // new one collapsed under its roots.
  const spansKey = allSpanIds.join('\u0000');
  const lastSpansKey = useRef(spansKey);
  useEffect(() => {
    if (lastSpansKey.current !== spansKey) {
      lastSpansKey.current = spansKey;
      setExpandedIds(new Set(allSpanIds));
      setFilter(EMPTY_SPAN_FILTER);
    }
  }, [spansKey, allSpanIds]);
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [view, setView] = useState<TraceView>(readStoredTraceView);

  const changeView = useCallback((next: TraceView) => {
    setView(next);
    writeStoredTraceView(next);
  }, []);

  // The chain of spans that actually gated the trace's end-to-end duration.
  // Computed once per trace and looked up per span while rendering.
  const criticalPath = useMemo(
    () => (showCriticalPath ? computeCriticalPath(spans) : new Map()),
    [spans, showCriticalPath]
  );

  const services = useMemo(() => traceServices(spans, processes), [spans, processes]);
  const filterActive = isSpanFilterActive(filter);
  const { matched, visible } = useMemo(
    () => filterSpans(spans, processes, filter),
    [spans, processes, filter]
  );

  // The single span worth optimising, rather than every ancestor that happens
  // to carry a critical segment.
  const heaviestSpanId = useMemo(() => heaviestCriticalSpanId(criticalPath), [criticalPath]);

  const allNodes = useMemo(
    () => buildFlatTree(spans, expandedIds, trace.traceID),
    [spans, expandedIds, trace.traceID]
  );
  // Matches keep their ancestors, so a hit stays readable in its own context.
  const flatNodes = useMemo(
    () => (filterActive ? allNodes.filter((n) => visible.has(n.span.spanID)) : allNodes),
    [allNodes, filterActive, visible]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A large trace holds thousands of rows; mounting them all makes scrolling
  // unusable, which is why visum virtualizes this list too.
  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => scrollRef.current,
    // Until the element has been measured — first paint, and anywhere without
    // layout — assume a screenful rather than withholding every row.
    initialRect: { width: 0, height: INITIAL_VIEWPORT_PX },
    // Rows are one line each, so a fixed size beats measuring every row.
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 16,
  });

  // Selecting a span elsewhere — a deep link, or the table view — should bring
  // it into view rather than leave the reader to hunt for it.
  useEffect(() => {
    if (!selectedSpanId) {
      return;
    }
    const index = flatNodes.findIndex((n) => n.span.spanID === selectedSpanId);
    if (index >= 0) {
      const frame = requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }));
      return () => cancelAnimationFrame(frame);
    }
    return;
  }, [selectedSpanId, flatNodes, virtualizer]);

  const toggleExpand = useCallback(
    (spanId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(spanId)) {next.delete(spanId);}
        else {next.add(spanId);}
        return next;
      });
    },
    []
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span>Trace ID:</span>
          <span className={styles.traceId}>{traceID}</span>
        </div>
        <div className={styles.headerMeta}>
          <span>Started:</span>
          <span className={styles.badge}>{formatTimestampMs(rootSpan?.startTime ?? traceMinMs)}</span>
          <span>Duration:</span>
          <span className={styles.badge}>{formatDurationMs(totalDurationMs)}</span>
          <span>Spans:</span>
          <span className={styles.badge}>{spans.length}</span>
          <span>Errors:</span>
          <span className={errorCount > 0 ? styles.errorBadge : styles.badge}>{errorCount}</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={() => setExpandedIds(new Set())}>
            Collapse all
          </button>
          <button className={styles.actionBtn} onClick={() => setExpandedIds(new Set(allSpanIds))}>
            Expand all
          </button>
          <button
            className={view === 'waterfall' ? styles.actionBtnActive : styles.actionBtn}
            onClick={() => changeView('waterfall')}
            aria-pressed={view === 'waterfall'}
          >
            Waterfall
          </button>
          <button
            className={view === 'table' ? styles.actionBtnActive : styles.actionBtn}
            onClick={() => changeView('table')}
            aria-pressed={view === 'table'}
          >
            Table
          </button>
          <button
            className={showCriticalPath ? styles.actionBtnActive : styles.actionBtn}
            onClick={() => setShowCriticalPath((v) => !v)}
            aria-pressed={showCriticalPath}
            title="Highlight the spans that gated the trace's duration"
          >
            Critical path
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <SpanTable trace={trace} selectedSpanId={selectedSpanId} onSelectSpan={onSelectSpan} />
      ) : (
        <>
      <div className={styles.filterBar}>
        <Input
          value={filter.text}
          onChange={(e) => {
            // Read before the updater runs: React releases the event first.
            const text = e.currentTarget.value;
            setFilter((f) => ({ ...f, text }));
          }}
          placeholder="Filter spans…"
          aria-label="Filter spans"
          width={28}
        />
        <MultiSelect
          options={services.map((service) => ({ label: service, value: service }))}
          value={filter.services as string[]}
          onChange={(picked) =>
            setFilter((f) => ({ ...f, services: picked.map((o) => o.value!).filter(Boolean) }))
          }
          placeholder="All services"
          aria-label="Filter by service"
          width={28}
        />
        <Checkbox
          value={filter.errorsOnly}
          onChange={(e) => {
            const errorsOnly = e.currentTarget.checked;
            setFilter((f) => ({ ...f, errorsOnly }));
          }}
          label="Errors only"
          aria-label="Errors only"
        />
        {filterActive && (
          <span className={styles.filterCount}>
            {matched.size} of {spans.length} spans
          </span>
        )}
      </div>

      <div className={styles.tableHeader}>
        <div className={styles.tableHeaderCell}>
          <span>Service</span>
          <Icon name="angle-right" size="sm" />
          <span>Operation</span>
        </div>
        <div className={styles.tableHeaderCell}>
          <TimelineRuler totalDurationMs={totalDurationMs} />
        </div>
      </div>

      <div ref={scrollRef} className={styles.rowsWrap}>
        {flatNodes.length === 0 ? (
          <div className={styles.emptyFilter}>No spans match this filter.</div>
        ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const node = flatNodes[virtualRow.index];
          const { span, depth, hasChildren, isExpanded } = node;
          const process = processes[span.processID];
          const serviceName = process?.serviceName ?? span.processID;
          const hasError = isErrorSpan(span.tags);
          const isSelected = span.spanID === selectedSpanId;

          return (
            <div
              key={span.spanID}
              data-index={virtualRow.index}
              className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT_PX,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => onSelectSpan?.(span.spanID)}
            >
              <div className={styles.rowLeft} style={{ paddingLeft: `${8 + depth * INDENT_PX}px` }}>
                {hasChildren ? (
                  <span
                    className={styles.expandIcon}
                    role="button"
                    tabIndex={0}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${span.operationName}`}
                    onClick={(e) => { e.stopPropagation(); toggleExpand(span.spanID); }}
                  >
                    <Icon name={isExpanded ? 'angle-down' : 'angle-right'} size="sm" />
                  </span>
                ) : (
                  <span className={styles.leafIcon} />
                )}
                <span
                  className={styles.serviceDot}
                  style={{ background: colorForService(serviceName) }}
                  aria-hidden
                />
                <div className={styles.spanName}>
                  <span className={styles.serviceName}>{serviceName}</span>
                  <Icon name="angle-right" size="xs" className={styles.arrow} />
                  <span className={styles.opName}>{span.operationName}</span>
                  {hasError && <span className={styles.errorSpan}>error</span>}
                  {span.spanID === heaviestSpanId && (
                    <span className={styles.criticalBadge} title="Owns most of the critical path">
                      critical
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.rowRight}>
                <SpanDuration
                  span={span}
                  minMs={traceMinMs}
                  maxMs={traceMaxMs}
                  serviceName={serviceName}
                  hasError={hasError}
                  criticalSegments={criticalPath.get(span.spanID)}
                />
              </div>
            </div>
          );
        })}
        </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
