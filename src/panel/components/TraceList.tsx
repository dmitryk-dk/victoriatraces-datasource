import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import type { TraceSearchRow } from '../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';

interface TraceListProps {
  rows: TraceSearchRow[];
  onTraceClick?: (traceId: string) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    overflowX: 'auto',
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.body.fontSize,
    fontFamily: theme.typography.fontFamily,
  }),
  th: css({
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    textAlign: 'left',
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    borderBottom: `2px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  tr: css({
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:hover': { background: theme.colors.action.hover },
  }),
  td: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    verticalAlign: 'middle',
  }),
  traceIdBtn: css({
    background: 'none',
    border: 'none',
    color: theme.colors.primary.text,
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 0,
    textDecoration: 'underline',
    '&:hover': { color: theme.colors.primary.shade },
  }),
  serviceOp: css({
    fontFamily: 'monospace',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  serviceName: css({
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
  opName: css({
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  arrowIcon: css({
    color: theme.colors.text.disabled,
    flexShrink: 0,
  }),
  timestamp: css({
    fontFamily: 'monospace',
    fontSize: 12,
    whiteSpace: 'nowrap',
  }),
  durationCell: css({
    position: 'relative',
    minWidth: 120,
  }),
  durationBar: css({
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    background: theme.colors.primary.transparent,
    borderRadius: 2,
  }),
  durationText: css({
    position: 'relative',
    fontFamily: 'monospace',
    fontSize: 12,
    paddingLeft: theme.spacing(0.5),
    zIndex: 1,
  }),
  countCell: css({
    position: 'relative',
    minWidth: 80,
  }),
  countBar: css({
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    background: theme.colors.info.transparent,
    borderRadius: 2,
  }),
  countText: css({
    position: 'relative',
    fontFamily: 'monospace',
    fontSize: 12,
    paddingLeft: theme.spacing(0.5),
    zIndex: 1,
  }),
  errorBadge: css({
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: 'monospace',
    background: theme.colors.error.transparent,
    border: `1px solid ${theme.colors.error.border}`,
    color: theme.colors.error.text,
  }),
  noBadge: css({
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: 'monospace',
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.secondary,
  }),
});

export function TraceList({ rows, onTraceClick }: TraceListProps) {
  const styles = useStyles2(getStyles);

  if (!rows.length) {
    return <div style={{ padding: 16, color: 'gray' }}>No traces found.</div>;
  }

  const maxDuration = Math.max(...rows.map((r) => r.traceDuration), 1);
  const maxSpans = Math.max(...rows.map((r) => r.spanCount), 1);

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Trace ID</th>
            <th className={styles.th}>Service › Operation</th>
            <th className={styles.th}>Started at</th>
            <th className={styles.th}>Duration</th>
            <th className={styles.th}>Spans</th>
            <th className={styles.th} style={{ textAlign: 'center' }}>Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.traceID} className={styles.tr}>
              <td className={styles.td}>
                <button className={styles.traceIdBtn} onClick={() => onTraceClick?.(row.traceID)}>
                  {row.traceID}
                </button>
              </td>
              <td className={styles.td}>
                <div className={styles.serviceOp}>
                  <span className={styles.serviceName}>{row.rootServiceName}</span>
                  <span className={styles.arrowIcon}>›</span>
                  <span className={styles.opName}>{row.rootTraceName}</span>
                </div>
              </td>
              <td className={styles.td}>
                <span className={styles.timestamp}>{formatTimestampMs(row.startTime)}</span>
              </td>
              <td className={styles.td}>
                <div className={styles.durationCell}>
                  <div
                    className={styles.durationBar}
                    style={{ width: `${(row.traceDuration / maxDuration) * 100}%` }}
                  />
                  <span className={styles.durationText}>{formatDurationMs(row.traceDuration)}</span>
                </div>
              </td>
              <td className={styles.td}>
                <div className={styles.countCell}>
                  <div
                    className={styles.countBar}
                    style={{ width: `${(row.spanCount / maxSpans) * 100}%` }}
                  />
                  <span className={styles.countText}>{row.spanCount}</span>
                </div>
              </td>
              <td className={styles.td} style={{ textAlign: 'center' }}>
                <span className={row.errorCount ? styles.errorBadge : styles.noBadge}>
                  {row.errorCount ?? 0}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
