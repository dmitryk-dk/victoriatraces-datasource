import type { IconName } from '@grafana/data';

import { type FilterOperator, operatorMeta } from './fieldFilter';

export type SpanTypeId = 'http' | 'db' | 'rpc' | 'messaging' | 'genai';

export type TraceFilterKind =
  | 'operation'
  | 'tag'
  | 'field'
  | 'duration'
  | 'error'
  | 'spans'
  | 'spanType'
  | 'limit';

export type { FilterMode, FilterOperator } from './fieldFilter';
export { FILTER_OPERATORS, operatorMeta } from './fieldFilter';

export type TraceFilter =
  | { readonly kind: 'operation'; readonly value: string }
  | { readonly kind: 'tag'; readonly key: string; readonly value: string }
  // A free-form comparison: a field/operator/
  // value triple, a hand-written expression, or "everything".
  | {
      readonly kind: 'field';
      readonly mode: 'field';
      readonly field: string;
      readonly operator: FilterOperator;
      readonly value: string;
    }
  | { readonly kind: 'field'; readonly mode: 'custom'; readonly expr: string }
  | { readonly kind: 'field'; readonly mode: 'all' }
  | { readonly kind: 'duration'; readonly min?: string; readonly max?: string }
  | { readonly kind: 'error' }
  | { readonly kind: 'spans'; readonly min?: number; readonly max?: number }
  | { readonly kind: 'spanType'; readonly value: SpanTypeId }
  | { readonly kind: 'limit'; readonly value: number };

export const SPAN_TYPE_PRESETS: ReadonlyArray<{ id: SpanTypeId; label: string }> = [
  { id: 'http', label: 'HTTP requests' },
  { id: 'db', label: 'Database queries' },
  { id: 'rpc', label: 'gRPC / RPC' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'genai', label: 'Gen AI spans' },
];

const SPAN_TYPE_LABELS: Record<SpanTypeId, string> = Object.fromEntries(
  SPAN_TYPE_PRESETS.map((p) => [p.id, p.label])
) as Record<SpanTypeId, string>;

export const FILTER_LABELS: Record<TraceFilterKind, string> = {
  operation: 'Operation',
  tag: 'Tag',
  field: 'Field',
  duration: 'Duration',
  error: 'Error only',
  spans: 'Spans count',
  spanType: 'Span type',
  limit: 'Limit',
};

export const FILTER_DESCRIPTIONS: Record<TraceFilterKind, string> = {
  operation: 'Filter traces by operation name',
  tag: 'Filter by a span tag key/value pair',
  field: 'Compare any span field with an operator',
  duration: 'Filter by trace duration range',
  error: 'Show only traces containing errored spans',
  spans: 'Filter by number of spans per trace',
  spanType: 'Traces containing an HTTP, DB, RPC, … span',
  limit: 'Maximum number of traces to return',
};

export const FILTER_ICONS: Record<TraceFilterKind, IconName> = {
  operation: 'code-branch',
  tag: 'tag-alt',
  field: 'filter',
  duration: 'clock-nine',
  error: 'exclamation-triangle',
  spans: 'layer-group',
  spanType: 'sitemap',
  limit: 'list-ol',
};

/** Short human form of a filter, shown on its badge. */
export function summarizeFilter(f: TraceFilter): string {
  switch (f.kind) {
    case 'operation':
      return f.value;
    case 'tag':
      return `${f.key}="${f.value}"`;
    case 'field': {
      if (f.mode === 'all') {
        return 'everything';
      }
      if (f.mode === 'custom') {
        return f.expr;
      }
      const meta = operatorMeta(f.operator);
      return meta?.needsValue === false
        ? `${f.field} ${meta.label}`
        : `${f.field} ${meta?.label ?? f.operator} "${f.value}"`;
    }
    case 'duration': {
      const parts: string[] = [];
      if (f.min) {
        parts.push(`≥ ${f.min}`);
      }
      if (f.max) {
        parts.push(`≤ ${f.max}`);
      }
      return parts.length > 0 ? parts.join(', ') : 'any';
    }
    case 'error':
      return 'error';
    case 'spans': {
      const parts: string[] = [];
      if (f.min !== undefined) {
        parts.push(`≥ ${f.min}`);
      }
      if (f.max !== undefined) {
        parts.push(`≤ ${f.max}`);
      }
      return parts.length > 0 ? parts.join(', ') : 'any';
    }
    case 'spanType':
      return SPAN_TYPE_LABELS[f.value] ?? f.value;
    case 'limit':
      return String(f.value);
  }
}
