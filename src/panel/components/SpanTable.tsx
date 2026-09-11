import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import { isErrorSpan } from '../../trace-logic/spanTree';
import type { Trace } from '../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';
import { colorForService } from '../utils/serviceColor';

type SortKey = 'service' | 'name' | 'start' | 'duration' | 'errors';
type SortDir = 'asc' | 'desc';

interface Props {
  trace: Trace;
  selectedSpanId?: string;
  onSelectSpan?: (spanId: string) => void;
}

/**
 * Flat, sortable view of a trace's spans.
 *
 * The waterfall answers "when did this happen relative to everything else";
 * this answers "which spans are the slowest / which failed", which a nested
 * tree makes hard to see.
 */
export function SpanTable({ trace, selectedSpanId, onSelectSpan }: Props) {
  const styles = useStyles2(getStyles);
  const [sortKey, setSortKey] = useState<SortKey>('start');
  const [dir, setDir] = useState<SortDir>('asc');

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Durations and error counts are most useful largest-first; the rest read
      // naturally ascending.
      setDir(key === 'duration' || key === 'errors' ? 'desc' : 'asc');
    }
  };

  const rows = useMemo(() => {
    const decorated = trace.spans.map((span) => ({
      span,
      service: trace.processes[span.processID]?.serviceName ?? '',
      hasError: isErrorSpan(span.tags ?? []),
    }));

    const factor = dir === 'asc' ? 1 : -1;
    return decorated.sort((a, b) => {
      switch (sortKey) {
        case 'service':
          return factor * a.service.localeCompare(b.service);
        case 'name':
          return factor * a.span.operationName.localeCompare(b.span.operationName);
        case 'duration':
          return factor * (a.span.duration - b.span.duration);
        case 'errors':
          return factor * (Number(a.hasError) - Number(b.hasError));
        default:
          return factor * (a.span.startTime - b.span.startTime);
      }
    });
  }, [trace, sortKey, dir]);

  const traceStart = useMemo(() => Math.min(...trace.spans.map((s) => s.startTime)), [trace]);

  const header = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? styles.thNumeric : styles.th}>
      <button type="button" className={styles.sortBtn} onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key && <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size="sm" />}
      </button>
    </th>
  );

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header('service', 'Service')}
            {header('name', 'Operation')}
            {header('start', 'Start')}
            {header('duration', 'Duration', true)}
            {header('errors', 'Status')}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ span, service, hasError }) => (
            <tr
              key={span.spanID}
              className={selectedSpanId === span.spanID ? styles.rowSelected : styles.row}
              onClick={() => onSelectSpan?.(span.spanID)}
            >
              <td className={styles.td}>
                <span className={styles.service}>
                  <span
                    aria-hidden="true"
                    className={styles.dot}
                    style={{ background: colorForService(service) }}
                  />
                  {service}
                </span>
              </td>
              <td className={styles.td} title={span.operationName}>
                {span.operationName}
              </td>
              <td className={styles.tdMuted} title={formatTimestampMs(span.startTime)}>
                +{formatDurationMs(span.startTime - traceStart)}
              </td>
              <td className={styles.tdNumeric}>{formatDurationMs(span.duration)}</td>
              <td className={styles.td}>
                {hasError ? <span className={styles.error}>Error</span> : <span className={styles.ok}>OK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    flex: '1 1 0',
    minHeight: 0,
    overflow: 'auto',
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      textAlign: 'left',
      padding: theme.spacing(0.5, 1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
  }),
  th: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.secondary,
    whiteSpace: 'nowrap',
  }),
  thNumeric: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.secondary,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  }),
  sortBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: 'inherit',
    '&:hover': { color: theme.colors.text.primary },
  }),
  row: css({
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowSelected: css({
    cursor: 'pointer',
    background: theme.colors.primary.transparent,
  }),
  td: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 0,
  }),
  tdMuted: css({
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }),
  tdNumeric: css({
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }),
  service: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontWeight: theme.typography.fontWeightMedium,
  }),
  dot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  error: css({
    color: theme.colors.error.text,
  }),
  ok: css({
    color: theme.colors.text.secondary,
  }),
});
