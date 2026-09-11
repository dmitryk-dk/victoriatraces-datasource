import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Span, Trace } from '../types/trace';
import { SpanSummary } from '../../trace-logic/traceSummary';
import { fetchResource } from './resource';
import { ResourceState, useResource } from './useResource';

export const DEFAULT_TRACE_LIST_LIMIT = 50;

/** One row of the trace list, as returned by the `trace_list` resource. */
export interface TraceListRow {
  traceID: string;
  rootService: string;
  rootOperation: string;
  services: string[];
  /** RFC3339 timestamp of the trace's earliest span; also the paging cursor. */
  startTime: string;
  durationMicros: number;
  spans: number;
  errors: number;
  /** Root span outside the queried range, so service/operation are best-effort. */
  partial: boolean;
  /** Values for the caller's custom fields, keyed by field name. */
  attrs?: Record<string, string>;

  // Spans mode only. One row is a single span, so these describe it and the
  // per-trace aggregates above are not meaningful.
  spanID?: string;
  kind?: string;
  statusCode?: number;
  /** Span that satisfied the service/operation filter, if one was applied. */
  matchedSpanID?: string;
}

export interface TraceListParams {
  /** Raw LogsQL filter. Empty matches every span. */
  where?: string;
  /** Applied after the per-trace aggregation, e.g. "| filter spans:>=3". */
  postFilter?: string;
  /** Records which span satisfied the service/operation filter. */
  matchCond?: string;
  /** RFC3339. */
  start?: string;
  /** RFC3339. */
  end?: string;
  limit?: number;
  /**
   * Cursor to page back from, when the caller already holds a first page —
   * the panel's Grafana query result. Defaults to `end`.
   */
  after?: string;
  /** Fetch the first page on mount. False waits for loadMore(). */
  autoLoad?: boolean;
  /** Whether more pages may exist before anything has been fetched. */
  initiallyHasMore?: boolean;
}

export interface TraceListResult {
  rows: TraceListRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error?: Error;
  loadMore: () => void;
}

/**
 * Cursor-paged trace list. Rows are sorted newest first and the cursor is the
 * `startTime` of the last row seen, so paging walks backwards through time.
 * Rows are deduplicated by trace id because traces sharing a timestamp can
 * straddle a page boundary.
 */
export function useTraceList(uid: string | undefined, params: TraceListParams): TraceListResult {
  const {
    where = '',
    postFilter = '',
    matchCond = '',
    start,
    end,
    limit = DEFAULT_TRACE_LIST_LIMIT,
    after,
    autoLoad = true,
    initiallyHasMore = false,
  } = params;

  /** Where paging starts: the caller's oldest row, else the range end. */
  const origin = after ?? end;

  const [pages, setPages] = useState<TraceListRow[][]>([]);
  // The cursor carries the query it belongs to: a cursor left over from the
  // previous query would otherwise drive one more fetch on the render that
  // resets, refilling the rows that were just cleared.
  const [pager, setPager] = useState<{ key: string; cursor?: string }>(() => ({
    key: '',
    cursor: undefined,
  }));
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const enabled = Boolean(uid) && Boolean(start) && Boolean(end);

  const searchKey = `${uid}|${where}|${postFilter}|${matchCond}|${start}|${end}|${limit}|${origin}|${autoLoad}`;
  const searchKeyRef = useRef(searchKey);

  useEffect(() => {
    searchKeyRef.current = searchKey;
    setPages([]);
    setPager({ key: searchKey, cursor: autoLoad ? origin : undefined });
    setError(undefined);
  }, [searchKey, origin, autoLoad]);

  const cursor = pager.key === searchKey ? pager.cursor : undefined;

  useEffect(() => {
    if (!enabled || !cursor) {
      return;
    }

    const isFirstPage = cursor === origin;
    if (isFirstPage) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    const keyAtRequest = searchKeyRef.current;
    const subscription = fetchResource<TraceListRow[]>(uid!, 'trace_list', {
      where,
      postFilter,
      matchCond,
      start,
      end: cursor,
      limit,
    }).subscribe({
      next: (page) => {
        if (searchKeyRef.current !== keyAtRequest) {
          return;
        }
        setPages((current) => [...current, page ?? []]);
        setLoading(false);
        setLoadingMore(false);
      },
      error: (err: Error) => {
        if (searchKeyRef.current !== keyAtRequest) {
          return;
        }
        setError(err);
        setLoading(false);
        setLoadingMore(false);
      },
    });

    return () => subscription.unsubscribe();
  }, [uid, where, postFilter, matchCond, start, end, limit, cursor, enabled, origin]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: TraceListRow[] = [];
    for (const page of pages) {
      for (const row of page) {
        if (!seen.has(row.traceID)) {
          seen.add(row.traceID);
          out.push(row);
        }
      }
    }
    return out;
  }, [pages]);

  const lastPage = pages[pages.length - 1];
  // Before the first fetch only the caller knows whether its own page was full.
  const hasMore = lastPage === undefined ? initiallyHasMore : lastPage.length >= limit;

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) {
      return;
    }
    if (lastPage === undefined) {
      setPager({ key: searchKey, cursor: origin });
      return;
    }
    const oldest = lastPage[lastPage.length - 1]?.startTime;
    if (oldest) {
      setPager({ key: searchKey, cursor: oldest });
    }
  }, [hasMore, loading, loadingMore, lastPage, origin, searchKey]);

  return { rows, loading, loadingMore, hasMore, error, loadMore };
}

/** Ascending duration sample (µs) for one service+operation. */
export function useOperationDurations(
  uid: string | undefined,
  service: string | undefined,
  operation: string | undefined,
  rootOnly: boolean,
  start: string | undefined,
  end: string | undefined
): ResourceState<number[]> {
  const params = useMemo(
    () => ({ service, operation, rootOnly: rootOnly ? 'true' : 'false', start, end }),
    [service, operation, rootOnly, start, end]
  );
  return useResource<number[]>(uid, 'operation_durations', params, {
    enabled: Boolean(service) && Boolean(operation) && Boolean(start) && Boolean(end),
  });
}

export interface HeatmapCell {
  xi: number;
  yi: number;
  count: number;
  errors: number;
}

export interface HeatmapData {
  cells: HeatmapCell[];
  xCount: number;
  stepMs: number;
  startMs: number;
  yEdgesNs: number[];
}

/** Trace counts per (time bucket, duration bin) for the chart above the list. */
export function useHeatmap(
  uid: string | undefined,
  where: string,
  start: string | undefined,
  end: string | undefined,
  startMs: number,
  endMs: number
): ResourceState<HeatmapData> {
  const params = useMemo(
    () => ({ where, start, end, startMs, endMs }),
    [where, start, end, startMs, endMs]
  );
  return useResource<HeatmapData>(uid, 'heatmap', params, {
    enabled: Boolean(start) && Boolean(end) && endMs > startMs,
  });
}

export interface OperationStat {
  operation: string;
  spans: number;
  avgDurationMicros: number;
  errors: number;
}

/** Per-operation span counts, average duration and error counts for a service. */
/** Operations for a service, plus whether the backend's cap hid any. */
export interface OperationStatsResult {
  stats: OperationStat[];
  truncated: boolean;
}

export function useOperationStats(
  uid: string | undefined,
  service: string | undefined,
  start: string | undefined,
  end: string | undefined
): ResourceState<OperationStatsResult> {
  const params = useMemo(() => ({ service, start, end }), [service, start, end]);
  return useResource<OperationStatsResult>(uid, 'operation_stats', params, {
    enabled: Boolean(service) && Boolean(start) && Boolean(end),
  });
}

/** The scatter plot's sample, plus the size of the set it was drawn from. */
export interface TraceSampleResult {
  rows: TraceListRow[];
  total: number;
  loading: boolean;
  error?: Error;
}

/**
 * A sample of the traces in range for the scatter plot.
 *
 * Not a page of the trace list: that is ordered newest-first, so a limit
 * against a busy source returns a few seconds' worth and every point lands on
 * the right-hand edge. The backend orders this by trace id instead, which
 * spreads the sample across the whole range.
 */
export function useTraceSample(
  uid: string | undefined,
  where: string,
  start: string | undefined,
  end: string | undefined,
  limit: number
): TraceSampleResult {
  const params = useMemo(() => ({ where, start, end, limit }), [where, start, end, limit]);
  const state = useResource<{ rows: TraceListRow[]; total: number }>(uid, 'trace_sample', params, {
    enabled: Boolean(start) && Boolean(end),
  });
  return {
    rows: state.data?.rows ?? [],
    total: state.data?.total ?? 0,
    loading: state.loading,
    error: state.error,
  };
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facet {
  field: string;
  values: FacetValue[];
}

export const SERVICE_FIELD = 'resource_attr:service.name';
export const OPERATION_FIELD = 'name';

/**
 * Facet counts for the filter sidebar.
 *
 * The counts themselves stay unscoped: counts that shrink as you select turn
 * the sidebar into a dead end, because a value at zero disappears before you
 * can tell whether it would have combined with your other choices. Pass
 * `where` to ask a second time under the other active filters — that answer
 * says which values are still reachable, which the sidebar dims rather than
 * hides.
 */
export function useFacets(
  uid: string | undefined,
  fields: readonly string[],
  start: string | undefined,
  end: string | undefined,
  where?: string
): ResourceState<Facet[]> {
  const params = useMemo(
    () => ({ field: fields as string[], start, end, where }),
    [fields, start, end, where]
  );
  return useResource<Facet[]>(uid, 'facets', params, {
    enabled: fields.length > 0 && Boolean(start) && Boolean(end),
  });
}

const ERROR_TAG_KEYS = new Set(['error', 'otel.status_code', 'status.code']);

/** True when a span's tags mark it as failed. */
export function spanHasError(span: Span): boolean {
  return span.tags.some((tag) => {
    if (!ERROR_TAG_KEYS.has(tag.key)) {
      return false;
    }
    const value = String(tag.value).toLowerCase();
    return value === 'true' || value === 'error' || value === '2';
  });
}

/** Projects a fetched trace into the shape the summary helpers consume. */
export function toSpanSummaries(trace: Trace | undefined): SpanSummary[] {
  if (!trace) {
    return [];
  }
  return trace.spans.map((span) => ({
    spanId: span.spanID,
    parentSpanId: span.references.find((ref) => ref.refType === 'CHILD_OF')?.spanID,
    service: span.process?.serviceName ?? trace.processes[span.processID]?.serviceName ?? '',
    operation: span.operationName,
    durationMicros: span.duration,
    startMicros: span.startTime,
    error: spanHasError(span),
  }));
}
