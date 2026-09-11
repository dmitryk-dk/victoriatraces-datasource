import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ServiceDependency, Trace, TraceSummary } from '../types/trace';
import type { FieldName } from '../filters/tagKeys';
import { fetchResource } from './resource';
import { ResourceState, useResource } from './useResource';

export const DEFAULT_SEARCH_LIMIT = 50;

export function useServices(uid: string | undefined): ResourceState<string[]> {
  return useResource<string[]>(uid, 'services');
}

export function useOperations(uid: string | undefined, service: string | undefined): ResourceState<string[]> {
  const params = useMemo(() => ({ service }), [service]);
  return useResource<string[]>(uid, 'operations', params, { enabled: Boolean(service) });
}

/** RFC3339 bounds the metadata lookups are scoped to. */
export interface MetaRange {
  start?: string;
  end?: string;
}

/**
 * Span field names, optionally scoped to a service — the tag-key autocomplete.
 * Scoped to the range on screen, or the suggestions describe the whole
 * retention window instead of the traces being looked at.
 */
export function useFieldNames(
  uid: string | undefined,
  service: string | undefined,
  range: MetaRange = {}
): ResourceState<FieldName[]> {
  const { start, end } = range;
  const params = useMemo(() => ({ service, start, end }), [service, start, end]);
  return useResource<FieldName[]>(uid, 'field_names', params);
}

/** Values recorded for one span field — the tag-value autocomplete. */
export function useFieldValues(
  uid: string | undefined,
  field: string | undefined,
  service: string | undefined,
  range: MetaRange = {}
): ResourceState<string[]> {
  const { start, end } = range;
  const params = useMemo(
    () => ({ field, service, limit: 200, start, end }),
    [field, service, start, end]
  );
  return useResource<string[]>(uid, 'field_values', params, { enabled: Boolean(field) });
}

/** RFC3339 bounds for a trace-by-id lookup. */
export interface TraceWindow {
  start: string;
  end: string;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The range to look a trace up in.
 *
 * VictoriaTraces rejects a trace-by-id request without a range as out of
 * retention, so one is always sent. An hour either side of the trace's own
 * start covers spans that began before it or outlived it; with no start time
 * to work from, the last day is the widest range still cheap to scan.
 */
export function traceLookupWindow(startTime: string | undefined): TraceWindow {
  const startMs = startTime ? Date.parse(startTime) : NaN;
  if (Number.isNaN(startMs)) {
    const now = Date.now();
    return { start: new Date(now - 24 * HOUR_MS).toISOString(), end: new Date(now).toISOString() };
  }
  return {
    start: new Date(startMs - HOUR_MS).toISOString(),
    end: new Date(startMs + HOUR_MS).toISOString(),
  };
}

export function useTrace(
  uid: string | undefined,
  traceId: string | undefined,
  window: TraceWindow
): ResourceState<Trace> {
  const params = useMemo(() => ({ start: window.start, end: window.end }), [window.start, window.end]);
  return useResource<Trace>(uid, `trace/${encodeURIComponent(traceId ?? '')}`, params, {
    enabled: Boolean(traceId),
  });
}

export function useDependencies(
  uid: string | undefined,
  endTs: number | undefined,
  lookback: number | undefined
): ResourceState<ServiceDependency[]> {
  const params = useMemo(() => ({ endTs, lookback }), [endTs, lookback]);
  return useResource<ServiceDependency[]>(uid, 'dependencies', params, {
    enabled: endTs !== undefined && lookback !== undefined,
  });
}

export interface TraceSearchParams {
  /** LogsQL filter. Empty matches everything. */
  query?: string;
  /** Unix seconds. */
  start?: number;
  /** Unix seconds. */
  end?: number;
  limit?: number;
}

export interface TraceSearchResult {
  traces: TraceSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error?: Error;
  loadMore: () => void;
}

/**
 * Cursor-paged trace search, mirroring visum's infinite list.
 *
 * The cursor is the `end` bound, walked backwards: the next page ends one
 * second before the oldest trace already seen. Unlike an offset it cannot skip
 * or duplicate rows when new traces arrive mid-scroll, but it does mean the
 * page boundary is only as fine as one second, so results are deduplicated by
 * trace id.
 */
export function useTraceSearch(uid: string | undefined, params: TraceSearchParams): TraceSearchResult {
  const { query = '', start, end, limit = DEFAULT_SEARCH_LIMIT } = params;

  const [pages, setPages] = useState<TraceSummary[][]>([]);
  const [cursor, setCursor] = useState<number | undefined>(end);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const enabled = Boolean(uid) && start !== undefined && end !== undefined;

  // Identifies one search. Changing any input resets paging from the top.
  const searchKey = `${uid}|${query}|${start}|${end}|${limit}`;
  const searchKeyRef = useRef(searchKey);

  useEffect(() => {
    searchKeyRef.current = searchKey;
    setPages([]);
    setCursor(end);
    setError(undefined);
  }, [searchKey, end]);

  useEffect(() => {
    if (!enabled || cursor === undefined) {
      return;
    }

    // Derived from the cursor rather than pages.length: the reset effect and
    // this one run in the same commit, so `pages` here is still the previous
    // search's value and would misreport a fresh search as "loading more".
    const isFirstPage = cursor === end;
    if (isFirstPage) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    const keyAtRequest = searchKeyRef.current;
    const subscription = fetchResource<TraceSummary[]>(uid!, 'search', {
      q: query,
      start,
      end: cursor,
      limit,
    }).subscribe({
      next: (page) => {
        // A reset that landed while this was in flight wins.
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
  }, [uid, query, start, end, limit, cursor, enabled]);

  const traces = useMemo(() => {
    const seen = new Set<string>();
    const out: TraceSummary[] = [];
    for (const page of pages) {
      for (const trace of page) {
        if (!seen.has(trace.traceID)) {
          seen.add(trace.traceID);
          out.push(trace);
        }
      }
    }
    return out;
  }, [pages]);

  // A short page means the range is exhausted.
  const lastPage = pages[pages.length - 1];
  const hasMore = lastPage !== undefined && lastPage.length >= limit;

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || !lastPage?.length) {
      return;
    }
    const oldestNano = lastPage.reduce(
      (min, trace) => (trace.startTimeUnixNano < min ? trace.startTimeUnixNano : min),
      Number.POSITIVE_INFINITY
    );
    setCursor(Math.floor(oldestNano / 1e9) - 1);
  }, [hasMore, loading, loadingMore, lastPage]);

  return { traces, loading, loadingMore, hasMore, error, loadMore };
}
