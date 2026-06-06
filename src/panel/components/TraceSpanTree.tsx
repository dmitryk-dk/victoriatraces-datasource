import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import type { FlatSpanNode, Trace, TraceSpan } from '../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';
import { TimelineRuler } from './TimelineRuler';
import { SpanDuration, colorForService } from './SpanDuration';

interface TraceSpanTreeProps {
  trace: Trace;
  selectedSpanId?: string;
  onSelectSpan?: (spanId: string) => void;
}

const INDENT_PX = 16;

function buildFlatTree(
  spans: TraceSpan[],
  expandedIds: Set<string>
): FlatSpanNode[] {
  const childMap = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    const parentID = span.references.find((r) => r.refType === 'CHILD_OF')?.spanID ?? '';
    if (!childMap.has(parentID)) {childMap.set(parentID, []);}
    childMap.get(parentID)!.push(span);
  }

  const result: FlatSpanNode[] = [];

  function traverse(parentID: string, depth: number) {
    const children = childMap.get(parentID) ?? [];
    for (const span of children) {
      const hasChildren = (childMap.get(span.spanID)?.length ?? 0) > 0;
      const isExpanded = expandedIds.has(span.spanID);
      result.push({ span, depth, hasChildren, isExpanded });
      if (hasChildren && isExpanded) {
        traverse(span.spanID, depth + 1);
      }
    }
  }

  // Root spans have no CHILD_OF reference
  const roots = spans.filter((s) => !s.references.some((r) => r.refType === 'CHILD_OF'));
  for (const root of roots) {
    const hasChildren = (childMap.get(root.spanID)?.length ?? 0) > 0;
    const isExpanded = expandedIds.has(root.spanID);
    result.push({ span: root, depth: 0, hasChildren, isExpanded });
    if (hasChildren && isExpanded) {
      traverse(root.spanID, 1);
    }
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

  const rootSpan = spans.find((s) => !s.references.some((r) => r.refType === 'CHILD_OF'));
  const traceMinMs = Math.min(...spans.map((s) => s.startTime));
  const traceMaxMs = Math.max(...spans.map((s) => s.startTime + s.duration));
  const totalDurationMs = traceMaxMs - traceMinMs;
  const errorCount = spans.filter((s) => s.tags.some((t) => t.key === 'error' && t.value === 'true')).length;

  const allSpanIds = useMemo(() => spans.map((s) => s.spanID), [spans]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(allSpanIds));

  const flatNodes = useMemo(() => buildFlatTree(spans, expandedIds), [spans, expandedIds]);

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
        </div>
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

      <div className={styles.rowsWrap}>
        {flatNodes.map((node) => {
          const { span, depth, hasChildren, isExpanded } = node;
          const process = processes[span.processID];
          const serviceName = process?.serviceName ?? span.processID;
          const hasError = span.tags.some((t) => t.key === 'error' && t.value === 'true');
          const isSelected = span.spanID === selectedSpanId;

          return (
            <div
              key={span.spanID}
              className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
              onClick={() => onSelectSpan?.(span.spanID)}
            >
              <div className={styles.rowLeft} style={{ paddingLeft: `${8 + depth * INDENT_PX}px` }}>
                {hasChildren ? (
                  <span
                    className={styles.expandIcon}
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
                </div>
              </div>
              <div className={styles.rowRight}>
                <SpanDuration
                  span={span}
                  minMs={traceMinMs}
                  maxMs={traceMaxMs}
                  serviceName={serviceName}
                  hasError={hasError}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
