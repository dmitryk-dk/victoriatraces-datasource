import { locationService } from '@grafana/runtime';

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

export function navigateExplore(rebuild: (prev: any) => any) {
  const search = locationService.getSearch();

  const panesRaw = search.get('panes');
  if (panesRaw) {
    try {
      const panes = JSON.parse(decodeURIComponent(panesRaw));
      const updated = Object.fromEntries(
        Object.entries(panes as Record<string, any>).map(([id, pane]) => [
          id,
          { ...pane, queries: Array.isArray(pane.queries) ? pane.queries.map(rebuild) : pane.queries },
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
        left.queries = left.queries.map(rebuild);
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
    return rebuildTarget(q, {
      traceFilters: filters,
      where: derived.where,
      postFilter: derived.postFilter,
      matchCond: derived.matchCond,
      ...(derived.limit !== undefined ? { limit: derived.limit } : {}),
    });
  });
}
