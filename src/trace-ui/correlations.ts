import { getDataSourceSrv, locationService } from '@grafana/runtime';

import type { Trace, TraceSpan } from '../panel/types';
import {
  DEFAULT_TRACE_TO_LOGS_QUERY,
  type TraceToLogsOptions,
  type TraceToMetricsOptions,
} from '../types';

// Common field-name variants so `${__span.traceId}`, `${__span.trace_id}`,
// `${__span.trace.id}` and `${__span.traceID}` all resolve to the same value.
const TRACE_ID_FIELD_RE = /^trace[._-]?id$/i;
const SPAN_ID_FIELD_RE = /^span[._-]?id$/i;
const SERVICE_FIELD_RE = /^service([._-]?name)?$/i;
const OPERATION_FIELD_RE = /^operation([._-]?name)?$/i;

/**
 * MetricsQL label-value escaping. Prometheus / VictoriaMetrics expect
 * double-quoted values with `\`, `"`, newlines and tabs escaped.
 */
export function escapeMetricsQLValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Resolves a span-relative field by name, in order:
 * 1. span tags (user-defined span attributes)
 * 2. process tags (resource attributes — service.name, k8s.*, …)
 * 3. top-level span fields matched by name variant
 */
export function resolveSpanField(trace: Trace | undefined, span: TraceSpan, field: string): string {
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

/** Substitutes every `${__span.X}` placeholder in a correlation template. */
export function resolveSpanTemplate(trace: Trace | undefined, span: TraceSpan, template: string): string {
  return template.replace(/\$\{__span\.([\w.]+)\}/g, (_, name: string) =>
    resolveSpanField(trace, span, name.startsWith('tags.') ? name.slice('tags.'.length) : name)
  );
}

/**
 * Opens a correlation query in Explore's companion pane.
 *
 * Explore renders two panes, so adding one per click would silently stack
 * entries in the URL where only the second is shown. The first pane (the trace
 * view) is kept and the companion is always replaced, so clicking Metrics after
 * Logs swaps rather than accumulates.
 */
export function openSplitPane(dsUid: string, queries: Array<Record<string, unknown>>): void {
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
      const firstId = Object.keys(panes)[0];
      const companionId = Math.random().toString(36).slice(2, 10);
      const next: Record<string, unknown> = {};
      if (firstId) {
        next[firstId] = panes[firstId];
      }
      next[companionId] = { datasource: dsUid, queries: queriesWithDs };
      locationService.push({
        search:
          '?' +
          new URLSearchParams({
            ...Object.fromEntries(search.entries()),
            panes: JSON.stringify(next),
          }).toString(),
      });
      return;
    } catch {
      /* fall through to the legacy URL shape */
    }
  }

  // Legacy Explore URL (`left` + `right`) — overwrite `right`.
  const right = JSON.stringify({ datasource: dsUid, queries: queriesWithDs });
  locationService.push({
    search:
      '?' +
      new URLSearchParams({
        ...Object.fromEntries(search.entries()),
        right,
      }).toString(),
  });
}

/** Opens the configured trace-to-logs query for a span. */
export function openLogsForSpan(
  options: TraceToLogsOptions | undefined,
  trace: Trace | undefined,
  span: TraceSpan
): void {
  if (!options?.datasourceUid) {
    return;
  }
  const template = options.query?.trim() || DEFAULT_TRACE_TO_LOGS_QUERY;
  openSplitPane(options.datasourceUid, [
    { refId: 'A', expr: resolveSpanTemplate(trace, span, template), queryType: 'logsql-logs' },
  ]);
}

/** Opens a named trace-to-metrics query for a span. */
export function openMetricsQueryForSpan(
  options: TraceToMetricsOptions | undefined,
  trace: Trace | undefined,
  span: TraceSpan,
  query: string
): void {
  if (!options?.datasourceUid || !query.trim()) {
    return;
  }
  openSplitPane(options.datasourceUid, [
    { refId: 'A', expr: resolveSpanTemplate(trace, span, query) },
  ]);
}

/**
 * Builds a bare MetricsQL selector from the configured label mappings, used as
 * the default Metrics action when no named queries exist. Returns undefined
 * when no mapping resolves, so callers can hide the action.
 */
export function buildAutoMetricsSelector(
  options: TraceToMetricsOptions | undefined,
  trace: Trace | undefined,
  span: TraceSpan
): string | undefined {
  const mappings = options?.labelMappings ?? [];
  const parts = mappings
    .map((m) => {
      if (!m.metricLabel || !m.spanField) {
        return null;
      }
      const field = m.spanField.startsWith('tags.') ? m.spanField.slice('tags.'.length) : m.spanField;
      const value = resolveSpanField(trace, span, field);
      return value ? `${m.metricLabel}="${escapeMetricsQLValue(value)}"` : null;
    })
    .filter((s): s is string => s !== null);

  return parts.length > 0 ? `{${parts.join(', ')}}` : undefined;
}

/** Opens the auto-built metrics selector, if any mapping resolved. */
export function openAutoMetricsForSpan(
  options: TraceToMetricsOptions | undefined,
  trace: Trace | undefined,
  span: TraceSpan
): void {
  const expr = buildAutoMetricsSelector(options, trace, span);
  if (expr && options?.datasourceUid) {
    openSplitPane(options.datasourceUid, [{ refId: 'A', expr }]);
  }
}
