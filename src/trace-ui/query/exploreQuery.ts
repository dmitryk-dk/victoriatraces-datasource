import { getDataSourceSrv, locationService } from '@grafana/runtime';

import { buildTraceListQuery } from '../filters/logsql';
import type { TraceFilter } from '../filters/types';

/**
 * Edits to the Explore query, shared by the panels that make them.
 *
 * Both the trace list and the charts change the same query — a facet ticked in
 * the sidebar and an operation drilled from a chart are the same kind of edit —
 * so they go through one path: rewrite the query in the URL and let Explore
 * re-run it. That keeps the URL, the list and the charts describing the same
 * search, and makes a drill shareable.
 */

// Switching between search and traceId requires a fresh target, not a merge
// of the previous query. Spreading `...q` carries stale fields (serviceName,
// tags, expr…) into the new mode and the backend rejects the mixed payload
// before Explore has a chance to re-read the updated URL state — that's why
// the first request 400s and only the manual Refresh works.
export function rebuildTarget(prev: any, next: any) {
  return {
    refId: prev?.refId,
    datasource: prev?.datasource,
    hide: prev?.hide,
    ...next,
  };
}

/**
 * Changes some fields of a query, keeping the rest.
 *
 * For edits that stay in the same mode — a facet ticked, a filter drilled, a
 * column added. `rebuildTarget` is the wrong tool there: it keeps only what it
 * is handed, so an edit silently dropped `services`, `entity`, `expr` and
 * `customFields`, and the sidebar, which reads its ticks back off the query,
 * showed nothing selected.
 */
export function patchTarget(prev: any, next: any) {
  return { ...prev, ...next };
}

const PLUGIN_TYPE = 'victoriametrics-traces-datasource';

/**
 * Whether a query in a pane belongs to this datasource.
 *
 * Explore can hold a companion pane — trace to logs opens VictoriaLogs next to
 * the traces — and a mixed pane can hold other datasources' queries. An edit
 * made in our panels must not reach those. A query that names no datasource
 * takes the pane's; with neither known it is assumed ours, as a lone pane is.
 */
function isOwnQuery(query: any, paneDatasource: unknown): boolean {
  const ds = query?.datasource;
  if (ds?.type) {
    return ds.type === PLUGIN_TYPE;
  }
  const uid = ds?.uid ?? (typeof ds === 'string' ? ds : undefined) ?? paneDatasource;
  if (typeof uid !== 'string') {
    return true;
  }
  const type = getDataSourceSrv().getInstanceSettings(uid)?.type;
  return type === undefined || type === PLUGIN_TYPE;
}

function rebuildOwn(queries: unknown, paneDatasource: unknown, rebuild: (prev: any) => any) {
  return Array.isArray(queries)
    ? queries.map((q) => (isOwnQuery(q, paneDatasource) ? rebuild(q) : q))
    : queries;
}

export function navigateExplore(rebuild: (prev: any) => any) {
  const search = locationService.getSearch();

  const panesRaw = search.get('panes');
  if (panesRaw) {
    try {
      const panes = JSON.parse(decodeURIComponent(panesRaw));
      const updated = Object.fromEntries(
        Object.entries(panes as Record<string, any>).map(([id, pane]) => [
          id,
          { ...pane, queries: rebuildOwn(pane.queries, pane.datasource, rebuild) },
        ])
      );
      locationService.push({
        search: '?' + new URLSearchParams({
          ...Object.fromEntries(search.entries()),
          panes: JSON.stringify(updated),
        }).toString(),
      });
      return;
    } catch {
      /* fall through */
    }
  }

  const leftRaw = search.get('left');
  if (leftRaw) {
    try {
      const left = JSON.parse(decodeURIComponent(leftRaw));
      if (Array.isArray(left.queries)) {
        left.queries = rebuildOwn(left.queries, left.datasource, rebuild);
        locationService.push({
          search: '?' + new URLSearchParams({
            ...Object.fromEntries(search.entries()),
            left: JSON.stringify(left),
          }).toString(),
        });
      }
    } catch {
      /* ignore */
    }
  }
}


/**
 * The query a panel is showing.
 *
 * Explore builds a custom panel's data as {series, state, timeRange} — there is
 * no request on it — so `data.request.targets` is undefined there and the
 * services, filters, columns and derived LogsQL have to be read off the frame,
 * where the backend records the query it answered. Dashboards do pass a
 * request, and it is preferred: it is the query as it stands right now, while
 * the frame's is the one the last run used.
 */
export function queryFromData<T>(data: {
  series: Array<{ meta?: { custom?: unknown } }>;
  request?: { targets?: unknown[] };
}): T | undefined {
  const fromRequest = data.request?.targets?.[0] as T | undefined;
  if (fromRequest) {
    return fromRequest;
  }
  const carried = data.series
    .map((f) => (f.meta?.custom as { query?: unknown } | undefined)?.query)
    .find(Boolean);
  return carried as T | undefined;
}

/** The datasource uid a panel should make its resource calls against. */
export function datasourceUidFromData(data: {
  series: Array<{ meta?: { custom?: unknown }; fields?: any[] }>;
  request?: { targets?: any[] };
}): string | undefined {
  // The frame is the reliable source: Explore does not consistently populate
  // the request's datasource on the panel, and without a uid every resource
  // call the panel makes silently disables.
  const fromFrame = data.series.find(
    (f) => (f.meta?.custom as { datasourceUid?: string } | undefined)?.datasourceUid
  );
  return (
    (fromFrame?.meta?.custom as { datasourceUid?: string } | undefined)?.datasourceUid ??
    data.request?.targets?.[0]?.datasource?.uid ??
    data.series[0]?.fields?.[0]?.config?.links?.[0]?.internal?.datasourceUid
  );
}

/**
 * Adds filters to the query, replacing any of the kinds given.
 *
 * A drill from a chart and a filter added in the bar are the same edit, so
 * both land here rather than in panel state: the list re-queries, the charts
 * follow, and the URL says what is being looked at.
 */
export function addFiltersToQuery(
  added: TraceFilter[],
  replaceKinds: ReadonlySet<TraceFilter['kind']>
): void {
  navigateExplore((q) => {
    const current: TraceFilter[] = Array.isArray(q.traceFilters) ? q.traceFilters : [];
    const services: string[] = Array.isArray(q.services) ? q.services : [];
    const kept = current.filter((f) => !replaceKinds.has(f.kind));
    const filters = [...kept, ...added];
    const derived = buildTraceListQuery({ filters, services, rawQuery: q.expr ?? '' });
    return patchTarget(q, {
      traceFilters: filters,
      where: derived.where,
      postFilter: derived.postFilter,
      matchCond: derived.matchCond,
      ...(derived.limit !== undefined ? { limit: derived.limit } : {}),
    });
  });
}
