import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import { LoadingState, type GrafanaTheme2, type PanelProps, type SelectableValue } from '@grafana/data';
import { TraceList } from './components/TraceList';
import { TracesScatterPlot } from './components/TracesScatterPlot';
import { TraceSpanTree } from './components/TraceSpanTree';
import { SpanDetails } from './components/SpanDetails';
import { traceFrameToTrace, searchFrameToRows } from './utils/frameToTraces';
import {
  spanListFrameToRows,
  traceListFrameToRows,
  SPAN_LIST_FRAME_NAME,
  TRACE_LIST_FRAME_NAME,
} from '../trace-ui/api/traceListFrame';
import {
  useFacets,
  useTraceList,
  DEFAULT_TRACE_LIST_LIMIT,
  OPERATION_FIELD,
  SERVICE_FIELD,
  type TraceListRow,
} from '../trace-ui/api/traceList';
import { drillDurationFilter } from '../trace-ui/filters/chartDrill';
import { scopeFacetValues } from '../trace-ui/components/facetScope';
import { normalizeTagKey } from '../trace-ui/filters/tagKeys';
import type { ChartSelection } from '../trace-ui/components/heatmapGrid';
import { resolveSelectedSpan, type SpanSelection } from './utils/spanSelection';
import { TraceList as TraceListTable } from '../trace-ui/components/TraceList';
import { TracePreviewPanel } from '../trace-ui/components/TracePreviewPanel';
import { TracesListToolbar } from '../trace-ui/components/TracesListToolbar';
import {
  columnsForEntity,
  customColumns,
  loadHiddenColumns,
  saveHiddenColumns,
} from '../trace-ui/components/traceColumns';
import { useFieldNames } from '../trace-ui/api/traces';
import { TraceFilterSidebar } from '../trace-ui/components/TraceFilterSidebar';
import { TraceChartSelectionEvent } from '../trace-ui/events/chartSelection';
import { buildTraceListQuery } from '../trace-ui/filters/logsql';
import {
  datasourceUidFromData,
  queryFromData,
  navigateExplore,
  patchTarget,
  rebuildTarget,
} from '../trace-ui/query/exploreQuery';
import type { TraceFilter } from '../trace-ui/filters/types';
import type { Trace, TraceSpan } from './types';
import type { TraceToLogsOptions, TraceToMetricsOptions, VictoriaTracesQuery } from '../types';


const getStyles = (theme: GrafanaTheme2) => ({
  // Root container: fills the panel, no scroll
  root: css({
    display: 'flex',
    flexDirection: 'column',
    // A short panel scrolls as a whole rather than clipping the table: the
    // charts alone can fill a six-row dashboard panel.
    overflow: 'auto',
    fontFamily: theme.typography.fontFamily,
    boxSizing: 'border-box',
  }),
  // Root for trace detail: fills the panel, children handle scroll
  rootTrace: css({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: theme.typography.fontFamily,
    boxSizing: 'border-box',
  }),
  // Toolbar row for search view toggle
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    gap: theme.spacing(1),
  }),
  toolbarLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  // Toolbar for trace detail (back button row)
  traceToolbar: css({
    flexShrink: 0,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  // Content area: takes all remaining height
  contentWrap: css({
    flex: '1 1 0',
    minHeight: 0,
    overflowY: 'auto',
    padding: `0 ${theme.spacing(1)} ${theme.spacing(1)}`,
  }),
  // Fixed-height block above the list: charts and the list toolbar.
  listHeader: css({
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1, 0),
  }),
  // Trace detail: side-by-side span tree + span details, fills remaining height
  traceDetailLayout: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'stretch',
    width: '100%',
    flex: '1 1 0',
    // Always leave room for a few rows; without a floor the chart block above
    // squeezes the table down to nothing on a short panel.
    minHeight: 180,
    overflow: 'hidden',
    padding: theme.spacing(1),
  }),
  spanTree: css({
    flex: '1 1 0',
    minWidth: 0,
    overflow: 'hidden',
  }),
  spanDetailPanel: css({
    flexShrink: 0,
    width: 340,
    overflowY: 'auto',
  }),
  backBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover, color: theme.colors.text.primary },
  }),
  emptyState: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 0,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
});

type SearchView = 'plot' | 'table';

const searchViewOptions: Array<SelectableValue<SearchView>> = [
  { label: 'Plot', value: 'plot', icon: 'graph-bar' },
  { label: 'Table', value: 'table', icon: 'table' },
];

const FILTERS_OPEN_STORAGE_KEY = 'victoriatraces.filtersOpen';

/** Whether the sidebar is showing is a display preference, kept per browser. */
function readStoredFiltersOpen(): boolean {
  try {
    return localStorage.getItem(FILTERS_OPEN_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeStoredFiltersOpen(open: boolean): void {
  try {
    localStorage.setItem(FILTERS_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Storage disabled; the choice just will not survive a reload.
  }
}

export function TracePanel({ data, width, height, eventBus, onChangeTimeRange }: PanelProps) {
  const styles = useStyles2(getStyles);
  // Remembered with its trace: a choice made in one trace must not follow the
  // user into the next one, which has its own matched span to land on.
  const [spanSelection, setSpanSelection] = useState<SpanSelection | null>(null);
  const [searchView, setSearchView] = useState<SearchView>('plot');
  const [previewRow, setPreviewRow] = useState<TraceListRow | null>(null);
  // A window drawn on the charts panel. It drills the list without touching
  // the query, so the charts keep showing the full range.
  const [chartSelection, setChartSelection] = useState<ChartSelection | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadHiddenColumns);

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveHiddenColumns(next);
      return next;
    });
  }, []);

  const dsUid = datasourceUidFromData(data);
  const correlations = useMemo(() => {
    if (!dsUid) {
      // Fallback: find our datasource by type
      const allDs = getDataSourceSrv().getList({ type: 'victoriametrics-traces-datasource' });
      const settings = allDs[0] ? getDataSourceSrv().getInstanceSettings(allDs[0].uid) : undefined;
      const jsonData = settings?.jsonData as { traceToLogs?: TraceToLogsOptions; traceToMetrics?: TraceToMetricsOptions } | undefined;
      return {
        traceToLogs: jsonData?.traceToLogs,
        traceToMetrics: jsonData?.traceToMetrics,
      };
    }
    const settings = getDataSourceSrv().getInstanceSettings(dsUid);
    const jsonData = settings?.jsonData as { traceToLogs?: TraceToLogsOptions; traceToMetrics?: TraceToMetricsOptions } | undefined;
    return {
      traceToLogs: jsonData?.traceToLogs,
      traceToMetrics: jsonData?.traceToMetrics,
    };
  }, [dsUid]);

  const traceTarget = queryFromData<VictoriaTracesQuery>(data);
  const customFields = useMemo(() => traceTarget?.customFields ?? [], [traceTarget]);
  // Custom columns change what the backend aggregates, so they live in the
  // query rather than in panel state.
  const setCustomFields = useCallback((fields: string[]) => {
    navigateExplore((q) => patchTarget(q, { customFields: fields }));
  }, []);

  const metaRange = useMemo(
    () => ({ start: data.timeRange.from.toISOString(), end: data.timeRange.to.toISOString() }),
    [data.timeRange]
  );
  const fieldNames = useFieldNames(dsUid, undefined, metaRange);

  const traceListFrame = data.series.find((f) => f.name === TRACE_LIST_FRAME_NAME);
  const spanListFrame = data.series.find((f) => f.name === SPAN_LIST_FRAME_NAME);
  const listFrame = traceListFrame ?? spanListFrame;
  const entity: 'traces' | 'spans' = spanListFrame ? 'spans' : 'traces';

  const [showFilters, setShowFilters] = useState(readStoredFiltersOpen);
  const toggleFilters = useCallback((open: boolean) => {
    setShowFilters(open);
    writeStoredFiltersOpen(open);
  }, []);
  const facetFields = useMemo(() => [SERVICE_FIELD, OPERATION_FIELD], []);
  const facetUid = listFrame && showFilters ? dsUid : undefined;
  const startIso = data.timeRange.from.toISOString();
  const endIso = data.timeRange.to.toISOString();

  const facets = useFacets(facetUid, facetFields, startIso, endIso);

  // "Which of these values would still return traces, given everything else
  // that is selected." Each facet is scoped by the *other* filters, never by
  // its own, or selecting one service would rule out every other service.
  const activeFilters = useMemo<TraceFilter[]>(
    () => (Array.isArray(traceTarget?.traceFilters) ? traceTarget.traceFilters : []),
    [traceTarget]
  );
  const activeServices = useMemo(() => traceTarget?.services ?? [], [traceTarget]);

  const serviceScopeWhere = useMemo(
    () =>
      buildTraceListQuery({
        filters: activeFilters,
        services: [],
        rawQuery: traceTarget?.expr ?? '',
        entity,
      }).where,
    [activeFilters, traceTarget, entity]
  );
  const operationScopeWhere = useMemo(
    () =>
      buildTraceListQuery({
        filters: activeFilters.filter((f) => f.kind !== 'operation'),
        services: activeServices,
        rawQuery: traceTarget?.expr ?? '',
        entity,
      }).where,
    [activeFilters, activeServices, traceTarget, entity]
  );

  const serviceField = useMemo(() => [SERVICE_FIELD], []);
  const operationField = useMemo(() => [OPERATION_FIELD], []);
  const serviceScope = useFacets(facetUid, serviceField, startIso, endIso, serviceScopeWhere);
  const operationScope = useFacets(facetUid, operationField, startIso, endIso, operationScopeWhere);

  const scopedFacets = useMemo(() => {
    const scopeFor = (field: string) =>
      (field === SERVICE_FIELD ? serviceScope.data : operationScope.data)?.find((f) => f.field === field)
        ?.values;
    return (facets.data ?? []).map((facet) => ({
      field: facet.field,
      values: scopeFacetValues(facet.values, scopeFor(facet.field)),
    }));
  }, [facets.data, serviceScope.data, operationScope.data]);

  // Sidebar edits go through the query, like every other filter change.
  const applyFilters = useCallback(
    (next: { services?: string[]; filters?: TraceFilter[]; entity?: 'traces' | 'spans' }) => {
      navigateExplore((q) => {
        const services = next.services ?? (Array.isArray(q.services) ? q.services : []);
        const filters = next.filters ?? (Array.isArray(q.traceFilters) ? q.traceFilters : []);
        const nextEntity = next.entity ?? q.entity ?? 'traces';
        const derived = buildTraceListQuery({
          filters,
          services,
          rawQuery: q.expr ?? '',
          entity: nextEntity,
        });
        // Patched, not rebuilt: an edit here stays in the same mode, and the
        // sidebar reads its ticks back off the fields a rebuild would drop.
        return patchTarget(q, {
          queryType: nextEntity === 'spans' ? 'spanList' : 'traceList',
          entity: nextEntity,
          services,
          traceFilters: filters,
          where: derived.where,
          postFilter: derived.postFilter,
          matchCond: derived.matchCond,
          ...(derived.limit !== undefined ? { limit: derived.limit } : {}),
        });
      });
    },
    []
  );

  // Drilling from a chart adds a filter to the query, so the list, the charts
  // and the URL all stay in agreement — the same path the filter bar uses.

  // What the rows on screen represent. A change means the previewed trace may
  // no longer match, and its stats were computed against the old query, so the
  // preview is dropped rather than left to describe a stale result.
  const querySignature = useMemo(
    () =>
      JSON.stringify([
        data.timeRange.from.valueOf(),
        data.timeRange.to.valueOf(),
        traceTarget?.queryType,
        traceTarget?.where,
        traceTarget?.entity,
        traceTarget?.services,
        traceTarget?.traceFilters,
        traceTarget?.limit,
      ]),
    [data.timeRange, traceTarget]
  );

  useEffect(() => {
    setPreviewRow(null);
    setChartSelection(null);
  }, [querySignature]);

  // The charts are a separate panel; a window drawn there reaches the list
  // over the bus the two panels share.
  useEffect(() => {
    const sub = eventBus
      .getStream(TraceChartSelectionEvent)
      .subscribe((event) => setChartSelection(event.payload.selection));
    return () => sub.unsubscribe();
  }, [eventBus]);

  const searchFrame = data.series.find((f) => f.name === 'trace_search');
  const traceFrame = data.series.find((f) => f.name === 'traces');

  const frameRows = useMemo(() => {
    if (spanListFrame) {
      return spanListFrameToRows(spanListFrame);
    }
    return traceListFrame ? traceListFrameToRows(traceListFrame) : [];
  }, [traceListFrame, spanListFrame]);

  // A chart selection re-queries the list for its window rather than filtering
  // the rows already on screen, so a drill shows every matching trace and its
  // counts agree with the cell that was selected. The duration bound only ever
  // narrows the filter already in force.
  const drillQuery = useMemo(() => {
    if (!chartSelection) {
      return undefined;
    }
    const filters: TraceFilter[] = Array.isArray(traceTarget?.traceFilters)
      ? traceTarget.traceFilters
      : [];
    const duration = drillDurationFilter(
      filters.find((f) => f.kind === 'duration'),
      chartSelection
    );
    const drilled = [...filters.filter((f) => f.kind !== 'duration'), ...(duration ? [duration] : [])];
    const derived = buildTraceListQuery({
      filters: drilled,
      services: traceTarget?.services ?? [],
      rawQuery: traceTarget?.expr ?? '',
      entity,
    });
    return {
      where: derived.where,
      postFilter: derived.postFilter,
      matchCond: derived.matchCond,
      start: new Date(chartSelection.startMicros / 1000).toISOString(),
      end: new Date(chartSelection.endMicros / 1000).toISOString(),
      limit: derived.limit ?? traceTarget?.limit,
    };
  }, [chartSelection, traceTarget, entity]);

  const drill = useTraceList(drillQuery ? dsUid : undefined, drillQuery ?? {});

  // The panel's own query returns the first page. Older traces are fetched from
  // the resource endpoint, paging back from the oldest row already on screen,
  // so the list is not capped at whatever limit that query carried.
  const pageLimit = traceTarget?.limit ?? DEFAULT_TRACE_LIST_LIMIT;
  const oldestFrameRow = frameRows[frameRows.length - 1]?.startTime;
  const continuation = useTraceList(!drillQuery && listFrame ? dsUid : undefined, {
    where: traceTarget?.where ?? '',
    postFilter: traceTarget?.postFilter ?? '',
    matchCond: traceTarget?.matchCond ?? '',
    start: data.timeRange.from.toISOString(),
    end: data.timeRange.to.toISOString(),
    after: oldestFrameRow,
    autoLoad: false,
    // The frame does not report the limit that produced it, and inferring one
    // from the query is unreliable — a saved panel may carry none while the
    // backend applied its own. Offer more whenever there are rows and let the
    // fetch settle it: at the true end it comes back empty, once.
    initiallyHasMore: frameRows.length > 0,
    limit: pageLimit,
  });

  const traceListRows = useMemo(() => {
    if (drillQuery) {
      return drill.rows;
    }
    // A trace on the page boundary can come back in both, since the cursor is
    // only second-granular.
    const seen = new Set(frameRows.map((r) => r.traceID));
    return [...frameRows, ...continuation.rows.filter((r) => !seen.has(r.traceID))];
  }, [drillQuery, drill.rows, frameRows, continuation.rows]);

  const paging = drillQuery ? drill : continuation;

  // Grafana reports the panel query's own outcome; the drill and the
  // continuation report theirs. Either failing is worth saying out loud rather
  // than leaving the list to claim nothing matched.
  const listError = useMemo(() => {
    if (drillQuery) {
      return drill.error;
    }
    if (data.error) {
      return new Error(data.error.message ?? 'Query failed');
    }
    return continuation.error;
  }, [drillQuery, drill.error, data.error, continuation.error]);

  const listLoading =
    data.state === LoadingState.Loading || (drillQuery ? drill.loading : continuation.loading);

  // Committing a selection makes it the view: the panel's time range moves and
  // the duration bound joins the query, so the charts redraw around it.
  const searchRows = searchFrame ? searchFrameToRows(searchFrame) : [];
  const trace: Trace | null = traceFrame ? traceFrameToTrace(traceFrame) : null;

  const effectiveSpanId = resolveSelectedSpan(spanSelection, trace?.traceID, traceTarget?.spanId);
  const selectedSpan: TraceSpan | undefined = trace?.spans.find((s) => s.spanID === effectiveSpanId);

  const handleSelectSpan = useCallback(
    (spanId: string) => {
      if (!trace) {
        return;
      }
      setSpanSelection((prev) => ({
        traceID: trace.traceID,
        spanID: prev?.traceID === trace.traceID && prev.spanID === spanId ? undefined : spanId,
      }));
    },
    [trace]
  );

  const handleCloseSpanDetails = useCallback(() => {
    if (trace) {
      setSpanSelection({ traceID: trace.traceID, spanID: undefined });
    }
  }, [trace]);

  const handleTraceClick = useCallback((traceId: string) => {
    navigateExplore((q) => rebuildTarget(q, { queryType: 'traceId', traceId }));
  }, []);

  const handleBackToSearch = useCallback(() => {
    setSpanSelection(null);
    navigateExplore((q) => rebuildTarget(q, { queryType: 'search' }));
  }, []);

  // --- Panel instance: Trace detail only (traces frame) ---
  if (!searchFrame && !listFrame && trace) {
    return (
      <div style={{ width, height }} className={styles.rootTrace}>
        <div className={styles.traceToolbar}>
          <button className={styles.backBtn} onClick={handleBackToSearch}>← Back to search</button>
        </div>
        <div className={styles.traceDetailLayout}>
          <div className={styles.spanTree}>
            <TraceSpanTree
              trace={trace}
              selectedSpanId={effectiveSpanId}
              onSelectSpan={handleSelectSpan}
            />
          </div>
          {selectedSpan && (
            <div className={styles.spanDetailPanel}>
              <SpanDetails trace={trace} span={selectedSpan} onClose={handleCloseSpanDetails} traceToLogs={correlations.traceToLogs} traceToMetrics={correlations.traceToMetrics} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Panel instance: aggregated trace list (trace_list frame) ---
  if (listFrame) {
    // Carry the matched span through, so a row found via a service or
    // operation filter opens on that span rather than the trace's root.
    const openTrace = (row: TraceListRow) =>
      navigateExplore((q) =>
        rebuildTarget(q, {
          queryType: 'traceId',
          traceId: row.traceID,
          spanId: row.matchedSpanID ?? row.spanID,
        })
      );


    return (
      <div style={{ width, height }} className={styles.root}>
        {/* The toolbar keeps its natural height; the list below takes whatever
            remains and scrolls inside itself, so the panel fills the height
            Explore gives it instead of overflowing it. The charts are their own
            panel — see TraceChartsPanel — and reach the list over the event
            bus. */}
        <div className={styles.listHeader}>
          <TracesListToolbar
            onShowFilters={showFilters ? undefined : () => toggleFilters(true)}
            traceCount={traceListRows.length}
            search={listSearch}
            onSearchChange={setListSearch}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumn}
            customFields={customFields}
            onCustomFieldsChange={setCustomFields}
            availableFields={(fieldNames.data ?? []).map((f) => f.value)}
            entity={entity}
          />

        </div>

        <div className={styles.traceDetailLayout}>
          {showFilters && (
            <TraceFilterSidebar
                facets={scopedFacets}
                tagKeys={(fieldNames.data ?? []).map((f) => normalizeTagKey(f.value))}
                loading={facets.loading}
                services={traceTarget?.services ?? []}
                filters={traceTarget?.traceFilters ?? []}
                entity={entity}
                onEntityChange={(next) => applyFilters({ entity: next })}
                onServicesChange={(services) => applyFilters({ services })}
                onFiltersChange={(filters) => applyFilters({ filters })}
                onClose={() => toggleFilters(false)}
              />
            )}

            <TraceListTable
              rows={traceListRows}
              search={listSearch}
              loading={listLoading}
              error={listError}
              hasMore={paging.hasMore}
              loadingMore={paging.loadingMore}
              onLoadMore={paging.loadMore}
              columns={[
                ...columnsForEntity(entity).filter((c) => !hiddenColumns.has(c.key)),
                ...customColumns(customFields),
              ]}
              onPreviewRow={(row) =>
                setPreviewRow((current) => (current?.traceID === row.traceID ? null : row))
              }
              onOpenTrace={openTrace}
              previewedTraceId={previewRow?.traceID}
            />

            {previewRow && (
              <TracePreviewPanel
                uid={dsUid}
                row={previewRow}
                start={data.timeRange.from.toISOString()}
                end={data.timeRange.to.toISOString()}
                traceToLogs={correlations.traceToLogs}
                traceToMetrics={correlations.traceToMetrics}
                onClose={() => setPreviewRow(null)}
                onOpenTrace={() => openTrace(previewRow)}
              />
            )}
        </div>
      </div>
    );
  }

  // --- Panel instance: Search results (trace_search frame) ---
  if (searchRows.length > 0) {
    return (
      <div style={{ width, height }} className={styles.root}>
        <div className={styles.toolbar}>
          <span className={styles.toolbarLabel}>{searchRows.length} traces</span>
          <RadioButtonGroup
            size="sm"
            options={searchViewOptions}
            value={searchView}
            onChange={setSearchView}
          />
        </div>
        {searchView === 'plot' ? (
          <div className={styles.contentWrap}>
            <TracesScatterPlot rows={searchRows} onTraceClick={handleTraceClick} />
          </div>
        ) : (
          <div className={styles.contentWrap}>
            <TraceList rows={searchRows} onTraceClick={handleTraceClick} />
          </div>
        )}
      </div>
    );
  }

  // --- No data ---
  return (
    <div style={{ width, height }} className={styles.root}>
      <div className={styles.emptyState}>Run a query to see traces.</div>
    </div>
  );
}
