import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import type { Trace, TraceSpan } from '../types';
import { type TraceToLogsOptions, type TraceToMetricsOptions } from '../../types';
import {
  buildAutoMetricsSelector,
  openAutoMetricsForSpan,
  openLogsForSpan,
  openMetricsQueryForSpan,
} from '../../trace-ui/correlations';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';
import { groupSpanFields } from '../../trace-logic/spanFields';

interface SpanDetailsProps {
  trace?: Trace;
  span?: TraceSpan;
  onClose?: () => void;
  traceToLogs?: TraceToLogsOptions;
  traceToMetrics?: TraceToMetricsOptions;
}

type Tab = 'info' | 'fields' | 'logs';

const getStyles = (theme: GrafanaTheme2) => ({
  fieldGroupHeader: css({
    marginTop: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }),
  noFields: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  container: css({
    width: '100%',
    minWidth: 320,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '100%',
  }),
  titleBar: css({
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  titleText: css({
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: 'monospace',
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  closeBtn: css({
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.secondary,
    fontSize: 18,
    lineHeight: 1,
    padding: '0 4px',
    '&:hover': { color: theme.colors.text.primary },
  }),
  tabBar: css({
    display: 'flex',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  tab: css({
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderBottom: '2px solid transparent',
    '&:hover': { color: theme.colors.text.primary },
  }),
  tabActive: css({
    color: theme.colors.primary.text,
    borderBottomColor: theme.colors.primary.main,
  }),
  countBadge: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 8,
    padding: '0 6px',
    fontSize: 10,
    lineHeight: '16px',
  }),
  content: css({
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    tableLayout: 'fixed',
  }),
  th: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    textAlign: 'left',
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  tdKey: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    fontFamily: 'monospace',
    color: theme.colors.text.secondary,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    verticalAlign: 'top',
    width: '35%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  tdVal: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    fontFamily: 'monospace',
    fontWeight: theme.typography.fontWeightMedium,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    verticalAlign: 'top',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  tdValExpanded: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    fontFamily: 'monospace',
    fontWeight: theme.typography.fontWeightMedium,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    verticalAlign: 'top',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  }),
  showMoreBtn: css({
    fontSize: 10,
    cursor: 'pointer',
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: 4,
    background: 'transparent',
    color: theme.colors.text.secondary,
    padding: '1px 6px',
    marginLeft: 4,
    '&:hover': { background: theme.colors.action.hover },
  }),
  logEventCell: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    verticalAlign: 'top',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
    overflow: 'hidden',
  }),
  logEventName: css({
    fontFamily: 'monospace',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  logFieldBadge: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: 4,
    padding: '0 6px',
    fontSize: 10,
    fontFamily: 'monospace',
    display: 'inline-flex',
    gap: 4,
  }),
  logFieldKey: css({ color: theme.colors.text.secondary }),
  logFieldVal: css({ color: theme.colors.text.primary }),
  linksBar: css({
    display: 'flex',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexWrap: 'wrap',
  }),
  linkBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.primary.text,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    textDecoration: 'none',
    '&:hover': { background: theme.colors.action.hover },
  }),
});

function ExpandableCell({ value, styles }: { value: string; styles: ReturnType<typeof getStyles> }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const check = () => {
      if (ref.current && !expanded) {
        setTruncated(ref.current.scrollWidth > ref.current.clientWidth);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [expanded]);

  if (expanded) {
    return (
      <td className={styles.tdValExpanded}>
        {value}
        <button className={styles.showMoreBtn} onClick={() => setExpanded(false)}>show less</button>
      </td>
    );
  }
  return (
    <td className={styles.tdVal}>
      <span ref={ref} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
        {value}
      </span>
      {truncated && (
        <button className={styles.showMoreBtn} onClick={() => setExpanded(true)}>show more</button>
      )}
    </td>
  );
}

export function SpanDetails({ trace, span, onClose, traceToLogs, traceToMetrics }: SpanDetailsProps) {
  const styles = useStyles2(getStyles);
  const [tab, setTab] = useState<Tab>('fields');
  const [fieldSearch, setFieldSearch] = useState('');

  // Grouped by namespace and searchable: a span can carry dozens of
  // attributes, and a flat list of them is unreadable.
  const fieldGroups = useMemo(
    () => groupSpanFields(span?.tags ?? [], fieldSearch),
    [span?.tags, fieldSearch]
  );

  const copyValue = useCallback((value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
  }, []);

  const handleLogsClick = useCallback(() => {
    if (span) {
      openLogsForSpan(traceToLogs, trace, span);
    }
  }, [traceToLogs, trace, span]);

  const handleMetricsClick = useCallback(
    (query: string) => {
      if (span) {
        openMetricsQueryForSpan(traceToMetrics, trace, span, query);
      }
    },
    [traceToMetrics, trace, span]
  );

  const handleAutoMetricsClick = useCallback(() => {
    if (span) {
      openAutoMetricsForSpan(traceToMetrics, trace, span);
    }
  }, [traceToMetrics, trace, span]);

  if (!span) {return null;}

  const serviceName = span.processID && trace?.processes[span.processID]?.serviceName;
  const hasLogs = !!traceToLogs?.datasourceUid;

  // Build the list of metric buttons. Named queries take precedence; if none
  // are configured but label mappings exist, render a single auto-built
  // "Metrics" button that emits a bare `{label="value", ...}` selector.
  const namedQueries = (traceToMetrics?.queries ?? []).filter(
    (q) => q.name.trim() && q.query.trim()
  );
  const metricButtons: Array<{ name: string; onClick: () => void; tooltip?: string }> = [];
  if (traceToMetrics?.datasourceUid) {
    if (namedQueries.length > 0) {
      for (const q of namedQueries) {
        metricButtons.push({
          name: q.name,
          onClick: () => handleMetricsClick(q.query),
          tooltip: q.query,
        });
      }
    } else if (buildAutoMetricsSelector(traceToMetrics, trace, span)) {
      metricButtons.push({
        name: 'Metrics',
        onClick: handleAutoMetricsClick,
        tooltip: 'Auto-built selector from configured label mappings',
      });
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <span className={styles.titleText}>Span: {span.spanID}</span>
        {onClose && (
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        )}
      </div>

      {(hasLogs || metricButtons.length > 0) && (
        <div className={styles.linksBar}>
          {hasLogs && (
            <button className={styles.linkBtn} onClick={handleLogsClick}>
              Logs
            </button>
          )}
          {metricButtons.map((b) => (
            <button
              key={b.name}
              className={styles.linkBtn}
              onClick={b.onClick}
              title={b.tooltip}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className={styles.tabBar}>
        {(['info', 'fields', 'logs'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'info' ? 'Information' : t === 'fields' ? 'Fields' : 'Events'}
            {t === 'fields' && (
              <span className={styles.countBadge}>{span.tags?.length ?? 0}</span>
            )}
            {t === 'logs' && (
              <span className={styles.countBadge}>{span.logs?.length ?? 0}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === 'info' && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Property</th>
                <th className={styles.th}>Value</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Trace ID', span.traceID],
                ['Span ID', span.spanID],
                ['Service', serviceName ?? span.processID],
                ['Operation', span.operationName],
                ['Process ID', span.processID],
                ['Started', formatTimestampMs(span.startTime)],
                ['Duration', formatDurationMs(span.duration)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className={styles.tdKey}>{k}</td>
                  <td className={styles.tdVal}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'fields' && (
          <>
            <Input
              value={fieldSearch}
              onChange={(e) => setFieldSearch(e.currentTarget.value)}
              placeholder="Filter fields…"
              aria-label="Filter fields"
              prefix={<Icon name="search" />}
            />

            {fieldGroups.length === 0 ? (
              <p className={styles.noFields}>No fields match this filter.</p>
            ) : (
              fieldGroups.map((group) => (
                <div key={group.prefix}>
                  <div className={styles.fieldGroupHeader}>{group.prefix}</div>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Field</th>
                        <th className={styles.th}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.fields.map((tag) => (
                        <tr key={tag.key}>
                          <td className={styles.tdKey}>
                            {tag.key}
                            <IconButton
                              name="copy"
                              size="sm"
                              tooltip={`Copy ${tag.key}`}
                              onClick={() => copyValue(String(tag.value ?? ''))}
                            />
                          </td>
                          <ExpandableCell value={String(tag.value ?? '')} styles={styles} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </>
        )}

        {tab === 'logs' && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} style={{ width: '35%' }}>Timestamp</th>
                <th className={styles.th}>Event</th>
              </tr>
            </thead>
            <tbody>
              {(span.logs ?? []).map((log, i) => {
                const eventField = log.fields?.find((f) => f.key === 'event');
                const otherFields = log.fields?.filter((f) => f.key !== 'event') ?? [];
                return (
                  <tr key={i}>
                    <td className={styles.tdKey}>{formatTimestampMs(log.timestamp)}</td>
                    <td className={styles.logEventCell}>
                      {eventField && (
                        <span className={styles.logEventName}>{String(eventField.value)}</span>
                      )}
                      {otherFields.sort((a, b) => a.key.localeCompare(b.key)).map((f) => (
                        <span key={f.key} className={styles.logFieldBadge}>
                          <span className={styles.logFieldKey}>{f.key}</span>
                          <span>=</span>
                          <span className={styles.logFieldVal}>{String(f.value)}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
