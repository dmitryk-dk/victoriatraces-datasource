import { FILTER_OPERATORS, serializeFieldCondition } from './fieldFilter';
import { SpanTypeId, TraceFilter } from './types';

/** Quotes a value so it is matched literally rather than parsed as syntax. */
export function logsqlQuoteValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const DURATION_UNIT_NS: Record<string, number> = {
  ns: 1,
  us: 1e3,
  'µs': 1e3,
  ms: 1e6,
  s: 1e9,
  m: 6e10,
  h: 3.6e12,
};

/** Parses "250ms", "1.5s", "3 m" into nanoseconds. Invalid input yields undefined. */
export function parseDurationToNs(s: string | undefined): number | undefined {
  if (!s) {
    return undefined;
  }
  const m = s.trim().match(/^([\d.]+)\s*(ns|us|µs|ms|s|m|h)$/i);
  if (!m) {
    return undefined;
  }
  const value = Number.parseFloat(m[1]);
  const mult = DURATION_UNIT_NS[m[2].toLowerCase()];
  if (!Number.isFinite(value) || mult === undefined) {
    return undefined;
  }
  return Math.round(value * mult);
}

export const SPAN_TYPE_CONDITIONS: Record<SpanTypeId, string> = {
  http: '("span_attr:http.request.method":* OR "span_attr:http.method":*)',
  db: '"span_attr:db.system":*',
  rpc: '"span_attr:rpc.system":*',
  messaging: '"span_attr:messaging.system":*',
  genai: '"span_attr:gen_ai.system":*',
};

/**
 * Lifts a span-level condition to the trace level.
 *
 * A filter like "has an errored span" must keep the trace's *other* spans too,
 * so the condition selects trace ids in a subquery and the outer query matches
 * whole traces against them.
 */
export function traceContainsSubquery(cond: string): string {
  return `trace_id:in(span_id:* AND ${cond} | fields trace_id)`;
}

/** Every span record carries a span_id, so this narrows nothing on its own. */
const SPAN_BASE_FILTER = 'span_id:*';

export interface TraceListQuery {
  /** Span-level filter, applied before the stats aggregation. */
  where: string;
  /** Applied after the aggregation; references aggregated columns. */
  postFilter: string;
  /**
   * The bare service/operation condition, without the containment wrapper.
   * Traces mode uses it to record *which* span matched, so opening a filtered
   * row can land on that span rather than the trace's root.
   */
  matchCond: string;
  limit?: number;
}

export interface BuildQueryInput {
  filters: readonly TraceFilter[];
  services?: readonly string[];
  /** Free-form LogsQL typed by the user. */
  rawQuery?: string;
  /**
   * Traces mode matches whole traces that *contain* a matching span; spans mode
   * matches the spans themselves, so it needs no containment subquery.
   */
  entity?: 'traces' | 'spans';
}

/**
 * Turns the filter set into the two LogsQL fragments the `trace_list` resource
 * takes.
 *
 * Which fragment a filter lands in is decided by what it can see: service,
 * operation, tag, span-type and error filters describe individual spans, so
 * they belong in `where`. Span count and trace duration only exist once spans
 * are aggregated per trace, so they must be applied afterwards.
 */
export function buildTraceListQuery({
  filters,
  services = [],
  rawQuery,
  entity = 'traces',
}: BuildQueryInput): TraceListQuery {
  const whereParts: string[] = [];
  const postParts: string[] = [];
  let limit: number | undefined;

  // In spans mode a condition stands alone; in traces mode it selects the
  // traces that contain a matching span.
  const scope = (cond: string) => (entity === 'spans' ? cond : traceContainsSubquery(cond));

  const operations = filters.filter((f) => f.kind === 'operation').map((f) => f.value);

  // Service and operation are span-level facets: a trace matches if any of its
  // spans does, so they go through the containment subquery together.
  const facetConds: string[] = [];
  if (services.length > 0) {
    facetConds.push(`"resource_attr:service.name":in(${services.map(logsqlQuoteValue).join(',')})`);
  }
  if (operations.length > 0) {
    facetConds.push(`name:in(${operations.map(logsqlQuoteValue).join(',')})`);
  }
  if (facetConds.length > 0) {
    whereParts.push(scope(facetConds.join(' AND ')));
  }

  for (const filter of filters) {
    switch (filter.kind) {
      case 'tag': {
        // The key may be stored bare or under either attribute prefix.
        const qv = logsqlQuoteValue(filter.value);
        whereParts.push(
          scope(`("${filter.key}":${qv} OR "span_attr:${filter.key}":${qv} OR "resource_attr:${filter.key}":${qv})`)
        );
        break;
      }
      case 'field': {
        // "all" matches everything, which adds nothing to a filter chain.
        if (filter.mode === 'all') {
          break;
        }
        if (filter.mode === 'custom') {
          const expr = filter.expr.trim();
          if (expr) {
            whereParts.push(scope(expr));
          }
          break;
        }
        if (!filter.field) {
          break;
        }
        const meta = FILTER_OPERATORS.find((o) => o.id === filter.operator);
        // Every operator but `exists` needs something to compare against.
        if (meta?.needsValue !== false && filter.value === '') {
          break;
        }
        whereParts.push(scope(serializeFieldCondition(filter.field, filter.operator, filter.value)));
        break;
      }
      case 'error':
        whereParts.push(scope('status_code:2'));
        break;
      case 'spanType':
        whereParts.push(scope(SPAN_TYPE_CONDITIONS[filter.value]));
        break;
      case 'spans':
        // Span count is a per-trace aggregate; it has no meaning for a
        // single span, so spans mode ignores it.
        if (entity === 'traces') {
          if (filter.min !== undefined) {
            postParts.push(`spans:>=${filter.min}`);
          }
          if (filter.max !== undefined) {
            postParts.push(`spans:<=${filter.max}`);
          }
        }
        break;
      case 'duration': {
        const minNs = parseDurationToNs(filter.min);
        const maxNs = parseDurationToNs(filter.max);
        // Spans mode filters the span's own duration field directly; traces
        // mode compares the aggregated root-span duration after the stats step.
        if (entity === 'spans') {
          if (minNs !== undefined) {
            whereParts.push(`duration:>=${minNs}`);
          }
          if (maxNs !== undefined) {
            // Inclusive, matching the traces-mode bound: "≤ 2s" should include
            // a span of exactly 2s.
            whereParts.push(`duration:<=${maxNs}`);
          }
        } else {
          if (minNs !== undefined) {
            postParts.push(`durationNs:>=${minNs}`);
          }
          if (maxNs !== undefined) {
            postParts.push(`durationNs:<=${maxNs}`);
          }
        }
        break;
      }
      case 'limit':
        limit = filter.value;
        break;
      case 'operation':
        // Folded into the facet condition above.
        break;
    }
  }

  const raw = rawQuery?.trim();
  if (raw) {
    whereParts.push(scope(raw));
  }

  // Spans mode leads with a field-bearing filter so LogsQL always has one,
  // matching what the traces-mode aggregation gets from its default.
  if (entity === 'spans' && whereParts.length > 0) {
    whereParts.unshift(SPAN_BASE_FILTER);
  }

  return {
    where: whereParts.join(' AND '),
    postFilter: postParts.length > 0 ? `| filter ${postParts.join(' ')}` : '',
    matchCond: entity === 'traces' ? facetConds.join(' AND ') : '',
    limit,
  };
}
