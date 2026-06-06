import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { getDataSourceSrv, locationService } from '@grafana/runtime';
import type { GrafanaTheme2, PanelProps, SelectableValue } from '@grafana/data';
import { TraceList } from './components/TraceList';
import { TracesScatterPlot } from './components/TracesScatterPlot';
import { TraceSpanTree } from './components/TraceSpanTree';
import { SpanDetails } from './components/SpanDetails';
import { traceFrameToTrace, searchFrameToRows } from './utils/frameToTraces';
import type { Trace, TraceSpan } from './types';
import type { TraceToLogsOptions, TraceToMetricsOptions } from '../types';


const getStyles = (theme: GrafanaTheme2) => ({
  // Root container: fills the panel, no scroll
  root: css({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
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
  // Trace detail: side-by-side span tree + span details, fills remaining height
  traceDetailLayout: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'stretch',
    width: '100%',
    flex: '1 1 0',
    minHeight: 0,
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

// Switching between search and traceId requires a fresh target, not a merge
// of the previous query. Spreading `...q` carries stale fields (serviceName,
// tags, expr…) into the new mode and the backend rejects the mixed payload
// before Explore has a chance to re-read the updated URL state — that's why
// the first request 400s and only the manual Refresh works.
function rebuildTarget(prev: any, next: any) {
  return {
    refId: prev?.refId,
    datasource: prev?.datasource,
    hide: prev?.hide,
    ...next,
  };
}

function navigateExplore(rebuild: (prev: any) => any) {
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

type SearchView = 'plot' | 'table';

const searchViewOptions: Array<SelectableValue<SearchView>> = [
  { label: 'Plot', value: 'plot', icon: 'graph-bar' },
  { label: 'Table', value: 'table', icon: 'table' },
];

export function TracePanel({ data, width, height }: PanelProps) {
  const styles = useStyles2(getStyles);
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>();
  const [searchView, setSearchView] = useState<SearchView>('plot');

  const dsUid = data.request?.targets?.[0]?.datasource?.uid
    ?? (data.series[0]?.meta?.custom as any)?.datasourceUid
    ?? data.series[0]?.fields?.[0]?.config?.links?.[0]?.internal?.datasourceUid;
  const correlations = useMemo(() => {
    if (!dsUid) {
      // Fallback: find our datasource by type
      const allDs = getDataSourceSrv().getList({ type: 'victoriatraces-datasource' });
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

  const searchFrame = data.series.find((f) => f.name === 'trace_search');
  const traceFrame = data.series.find((f) => f.name === 'traces');

  const searchRows = searchFrame ? searchFrameToRows(searchFrame) : [];
  const trace: Trace | null = traceFrame ? traceFrameToTrace(traceFrame) : null;

  const selectedSpan: TraceSpan | undefined = trace?.spans.find((s) => s.spanID === selectedSpanId);

  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId((prev) => (prev === spanId ? undefined : spanId));
  }, []);

  const handleCloseSpanDetails = useCallback(() => setSelectedSpanId(undefined), []);

  const handleTraceClick = useCallback((traceId: string) => {
    navigateExplore((q) => rebuildTarget(q, { queryType: 'traceId', traceId }));
  }, []);

  const handleBackToSearch = useCallback(() => {
    setSelectedSpanId(undefined);
    navigateExplore((q) => rebuildTarget(q, { queryType: 'search' }));
  }, []);

  // --- Panel instance: Trace detail only (traces frame) ---
  if (!searchFrame && trace) {
    return (
      <div style={{ width, height }} className={styles.rootTrace}>
        <div className={styles.traceToolbar}>
          <button className={styles.backBtn} onClick={handleBackToSearch}>← Back to search</button>
        </div>
        <div className={styles.traceDetailLayout}>
          <div className={styles.spanTree}>
            <TraceSpanTree
              trace={trace}
              selectedSpanId={selectedSpanId}
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
