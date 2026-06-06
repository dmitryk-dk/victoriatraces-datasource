import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { getDataSourceSrv, locationService } from '@grafana/runtime';
import type { GrafanaTheme2 } from '@grafana/data';
import type { Trace, TraceSpan } from '../types';
import { DEFAULT_TRACE_TO_LOGS_QUERY, type TraceToLogsOptions, type TraceToMetricsOptions } from '../../types';
import { formatDurationMs, formatTimestampMs } from '../utils/formatDuration';

// Common field-name variants so `${__span.traceId}`, `${__span.trace_id}`,
// `${__span.trace.id}`, and `${__span.traceID}` all resolve to the same value.
// Patterns borrowed from the visum correlation model.
const TRACE_ID_FIELD_RE = /^trace[._-]?id$/i;
const SPAN_ID_FIELD_RE = /^span[._-]?id$/i;
const SERVICE_FIELD_RE = /^service([._-]?name)?$/i;
const OPERATION_FIELD_RE = /^operation([._-]?name)?$/i;

// MetricsQL label-value escaping. Prometheus / VictoriaMetrics expect
// double-quoted values with `\`, `"`, `\n`, and `\t` escaped.
function escapeMetricsQLValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

// Resolve a span-relative field by name. Order:
// 1. span.tags (user-defined span attributes)
// 2. process.tags (resource attributes — service.name, k8s.*, etc.)
// 3. top-level span fields by regex match (traceID/spanID/operationName/serviceName)
// 4. `tags.<key>` explicit prefix is also handled by the caller.
function resolveSpanField(trace: Trace | undefined, span: TraceSpan, field: string): string {
  const spanTag = span.tags?.find((t) => t.key === field);
  if (spanTag && spanTag.value !== '') {
    return String(spanTag.value);
  }
  const process = (span.processID && trace?.processes?.[span.processID]) || undefined;
  const procTag = process?.tags?.find((t) => t.key === field);
  if (procTag && procTag.value !== '') {
    return String(procTag.value);
  }
  if (TRACE_ID_FIELD_RE.test(field)) {
    return span.traceID ?? '';
  }
  if (SPAN_ID_FIELD_RE.test(field)) {
    return span.spanID ?? '';
  }
  if (OPERATION_FIELD_RE.test(field)) {
    return span.operationName ?? '';
  }
  if (SERVICE_FIELD_RE.test(field) && process?.serviceName) {
    return process.serviceName;
  }
  return '';
}

interface SpanDetailsProps {
  trace?: Trace;
  span?: TraceSpan;
  onClose?: () => void;
  traceToLogs?: TraceToLogsOptions;
  traceToMetrics?: TraceToMetricsOptions;
}

type Tab = 'info' | 'fields' | 'logs';

const getStyles = (theme: GrafanaTheme2) => ({
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

// Explore only renders two panes (left + the first "right"). Adding a new
// pane on every click would silently stack entries in the URL — only the
// second-in-order is shown. So we keep the first pane (the trace view) and
// always overwrite the second pane with the new correlation query.
function openSplitPane(dsUid: string, queries: Array<Record<string, unknown>>) {
  const search = locationService.getSearch();
  const dsSettings = getDataSourceSrv().getInstanceSettings(dsUid);
  const queriesWithDs = queries.map((q) => ({
    ...q,
    datasource: { uid: dsUid, type: dsSettings?.type ?? '' },
  }));

  const panesRaw = search.get('panes');
  if (panesRaw) {
    try {
      const panes = JSON.parse(decodeURIComponent(panesRaw));
      const ids = Object.keys(panes);
      const firstId = ids[0];
      // Drop every extra pane and re-create a single companion pane with the
      // new query so clicking Metrics after Logs (or vice versa) replaces
      // instead of stacking.
      const companionId = Math.random().toString(36).slice(2, 10);
      const next: Record<string, unknown> = {};
      if (firstId) {
        next[firstId] = panes[firstId];
      }
      next[companionId] = { datasource: dsUid, queries: queriesWithDs };
      locationService.push({
        search: '?' + new URLSearchParams({
          ...Object.fromEntries(search.entries()),
          panes: JSON.stringify(next),
        }).toString(),
      });
      return;
    } catch {
      /* fall through */
    }
  }

  // Legacy Explore URL (`left` + `right`) — just overwrite `right`.
  const right = JSON.stringify({ datasource: dsUid, queries: queriesWithDs });
  locationService.push({
    search: '?' + new URLSearchParams({
      ...Object.fromEntries(search.entries()),
      right,
    }).toString(),
  });
}

export function SpanDetails({ trace, span, onClose, traceToLogs, traceToMetrics }: SpanDetailsProps) {
  const styles = useStyles2(getStyles);
  const [tab, setTab] = useState<Tab>('fields');

  // Resolve ${__span.X} placeholders. Accepts variants (service/service_name/
  // service.name, traceId/trace_id/trace.id, etc.) and looks up span tags +
  // process resource attributes uniformly.
  const resolveTemplate = useCallback(
    (template: string): string => {
      if (!span) {
        return template;
      }
      return template.replace(/\$\{__span\.([\w.]+)\}/g, (_, name: string) => {
        if (name.startsWith('tags.')) {
          return resolveSpanField(trace, span, name.slice('tags.'.length));
        }
        return resolveSpanField(trace, span, name);
      });
    },
    [span, trace]
  );

  const handleLogsClick = useCallback(() => {
    if (!traceToLogs?.datasourceUid || !span) {
      return;
    }
    const tpl = (traceToLogs.query && traceToLogs.query.trim()) || DEFAULT_TRACE_TO_LOGS_QUERY;
    const expr = resolveTemplate(tpl);
    openSplitPane(traceToLogs.datasourceUid, [
      { refId: 'A', expr, queryType: 'logsql-logs' },
    ]);
  }, [traceToLogs, span, resolveTemplate]);

  const handleMetricsClick = useCallback(
    (query: string) => {
      if (!traceToMetrics?.datasourceUid || !span || !query.trim()) {
        return;
      }
      openSplitPane(traceToMetrics.datasourceUid, [
        { refId: 'A', expr: resolveTemplate(query) },
      ]);
    },
    [traceToMetrics, span, resolveTemplate]
  );

  // Build a bare MetricsQL selector from configured label mappings. Used as
  // the default Metrics button query when no named queries are set.
  const handleAutoMetricsClick = useCallback(() => {
    if (!traceToMetrics?.datasourceUid || !span) {
      return;
    }
    const mappings = traceToMetrics.labelMappings ?? [];
    const parts = mappings
      .map((m) => {
        if (!m.metricLabel || !m.spanField) {
          return null;
        }
        const value = m.spanField.startsWith('tags.')
          ? resolveSpanField(trace, span, m.spanField.slice('tags.'.length))
          : resolveSpanField(trace, span, m.spanField);
        if (!value) {
          return null;
        }
        return `${m.metricLabel}="${escapeMetricsQLValue(value)}"`;
      })
      .filter((s): s is string => s !== null);

    if (!parts.length) {
      return;
    }
    openSplitPane(traceToMetrics.datasourceUid, [
      { refId: 'A', expr: `{${parts.join(', ')}}` },
    ]);
  }, [traceToMetrics, span, trace]);

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
    } else if ((traceToMetrics.labelMappings ?? []).length > 0) {
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Field</th>
                <th className={styles.th}>Value</th>
              </tr>
            </thead>
            <tbody>
              {(span.tags ?? []).map((tag) => (
                <tr key={tag.key}>
                  <td className={styles.tdKey}>{tag.key}</td>
                  <ExpandableCell value={String(tag.value ?? '')} styles={styles} />
                </tr>
              ))}
            </tbody>
          </table>
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
