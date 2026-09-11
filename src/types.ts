import { DataQuery, DataSourceJsonData } from '@grafana/data';

import type { TraceFilter } from './trace-ui/filters/types';

// 'logsql'         → stats_query_range (time-series, for graph panels)
// 'logsql-instant' → stats_query       (single value, for stat/table panels)
// 'logsql-logs'    → /select/logsql/query (raw NDJSON log lines, for Logs panel)
// 'logsql-hits'    → /select/logsql/hits  (hit counts grouped by field, for Logs volume)
export type QueryType =
  | 'search'
  | 'traceList'
  | 'spanList'
  | 'traceId'
  | 'logsql'
  | 'logsql-instant'
  | 'logsql-logs'
  | 'logsql-hits';

export enum QueryEditorMode {
  Builder = 'builder',
  Code = 'code',
}

export interface VictoriaTracesQuery extends DataQuery {
  queryType: QueryType;
  // Trace ID mode
  traceId?: string;
  // Span to preselect in the waterfall — set when a filtered list row is
  // opened, so the view lands on the span that matched rather than the root.
  spanId?: string;
  // Search mode
  serviceName?: string;
  operationName?: string;
  // Space-separated key=value pairs, e.g. "http.status_code=200 error=true".
  // The backend converts these to the JSON format VictoriaTraces expects.
  tags?: string;
  /** Search mode duration bounds, as the Jaeger API spells them ("100ms", "2s"). */
  minDuration?: string;
  maxDuration?: string;
  limit?: number;
  // LogsQL mode fields
  // Raw LogsQL expression, e.g. `* | stats by ("resource_attr:service.name") count() requests`
  expr?: string;
  // Optional step override for range queries, e.g. "1m". Backend auto-calculates when omitted.
  step?: string;
  // Legend format using {{ label }} placeholders, e.g. "{{ resource_attr:service.name }}"
  legendFormat?: string;
  // Timezone offset for bucket alignment — auto-calculated from dashboard timezone, not user-facing.
  timezoneOffset?: string;
  // Fields to group by for hits queries (e.g. ["level"])
  fields?: string[];

  // Trace-list mode. The filter bar keeps its structured state here and derives
  // `where` / `postFilter` from it, so a saved query can be reopened for editing
  // rather than only replayed.
  services?: string[];
  traceFilters?: TraceFilter[];
  // Span-level LogsQL, applied before the per-trace aggregation.
  where?: string;
  // Applied after the aggregation, e.g. "| filter spans:>=3".
  postFilter?: string;
  // Bare service/operation condition, used to record which span matched.
  matchCond?: string;
  // Extra span fields surfaced as list columns, read from the root span.
  customFields?: string[];
  // Whether the list shows whole traces or individual spans. Mirrored by the
  // query type, which is what the backend dispatches on.
  entity?: 'traces' | 'spans';
}

export const defaultQuery: Partial<VictoriaTracesQuery> = {
  queryType: 'traceList',
  limit: 20,
};

export interface NodeGraphOptions {
  enabled?: boolean;
}

// Placeholders supported in `query` and `queries[].query`:
//   ${__span.service}  → resolved service name
//   ${__span.operation}→ operation name
//   ${__span.traceId}  → trace ID
//   ${__span.spanId}   → span ID
//   ${__span.tags.foo} → value of span tag "foo"

export interface TraceToLogsOptions {
  datasourceUid?: string;
  // LogsQL template. Empty → DEFAULT_TRACE_TO_LOGS_QUERY is used.
  query?: string;
}

export interface TraceToMetricsQuery {
  name: string;
  query: string;
}

// One row maps a span field to a metric label. When at least one row is set
// and no named queries are configured, the plugin auto-builds a MetricsQL
// label selector `{label="value", ...}` from these mappings and renders a
// single "Metrics" button.
export interface TraceToMetricsLabelMapping {
  // Field on the span. Resolved via the same lookup as ${__span.X} —
  // accepts any of: service, service.name, service_name, traceId, trace.id,
  // trace_id, traceID, spanId, span.id, operation, operation.name,
  // tags.<key>, or a tag key directly (e.g. http.status_code).
  spanField: string;
  // Label name to use on the metric query.
  metricLabel: string;
}

export interface TraceToMetricsOptions {
  datasourceUid?: string;
  // Each entry renders a separate button in the span detail panel.
  queries?: TraceToMetricsQuery[];
  // Auto-built `{label="value"}` selector. Used as the default Metrics
  // button when `queries` is empty. Ignored otherwise.
  labelMappings?: TraceToMetricsLabelMapping[];
}

// Sensible default for OTel-flavoured ingest into VictoriaLogs.
export const DEFAULT_TRACE_TO_LOGS_QUERY =
  'trace_id:=${__span.traceId} AND "service.name":=${__span.service}';

// DerivedFieldConfig defines one rule for extracting a value from a log/span
// record and turning it into a clickable link — identical shape to the
// VictoriaLogs datasource so the same mental model applies.
export interface DerivedFieldConfig {
  // Display name for the extracted field shown in the Logs panel.
  name: string;
  // 'label'  → match by label/field key in the labels JSON object
  // 'regex'  → apply matcherRegex against the log line (_msg)
  matcherType?: 'label' | 'regex';
  // Either a label key (when matcherType === 'label') or a JS regex string
  // with a capture group (when matcherType === 'regex').
  matcherRegex: string;
  // For external links: the URL template, e.g. "http://jaeger/trace/${__value.raw}"
  url?: string;
  // Button label override shown in the Logs panel.
  urlDisplayLabel?: string;
  // For internal links: UID of the target datasource.
  datasourceUid?: string;
}

export interface VictoriaTracesOptions extends DataSourceJsonData {
  url?: string;
  nodeGraph?: NodeGraphOptions;
  traceToLogs?: TraceToLogsOptions;
  traceToMetrics?: TraceToMetricsOptions;
  derivedFields?: DerivedFieldConfig[];
}
