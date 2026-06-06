import React, { Component, useCallback, useMemo, type ReactNode } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import type { GrafanaTheme2, PanelProps } from '@grafana/data';
import { DependencyGraph } from '../panel/components/DependencyGraph';
import { fieldValues } from '../panel/utils/frameToTraces';

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: theme.typography.fontFamily,
    boxSizing: 'border-box',
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

function navigateExploreToService(service: string) {
  const search = locationService.getSearch();
  const rebuild = (q: any) => ({
    refId: q?.refId,
    datasource: q?.datasource,
    hide: q?.hide,
    queryType: 'search',
    serviceName: service,
  });

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

export function NodeGraphPanel({ data, width, height }: PanelProps) {
  const styles = useStyles2(getStyles);

  const handleNodeClick = useCallback(navigateExploreToService, []);

  const nodesFrame = data.series.find((f) => f.name === 'nodes');
  const edgesFrame = data.series.find((f) => f.name === 'edges');

  const nodeIds = useMemo(
    () => (nodesFrame ? (fieldValues(nodesFrame, 'id') as string[]) : []),
    [nodesFrame]
  );

  const edges = useMemo(() => {
    if (!edgesFrame) {
      return [];
    }
    const sources = fieldValues(edgesFrame, 'source') as string[];
    const targets = fieldValues(edgesFrame, 'target') as string[];
    const counts = fieldValues(edgesFrame, 'secondarystat') as number[];
    return sources.map((source, i) => ({
      source,
      target: targets[i],
      callCount: Math.round(counts[i] ?? 1),
    }));
  }, [edgesFrame]);

  if (!nodesFrame) {
    return (
      <div style={{ width, height }} className={styles.root}>
        <div className={styles.emptyState}>No node graph data available.</div>
      </div>
    );
  }

  return (
    <div style={{ width, height }} className={styles.root}>
      <ErrorBoundary fallback={<div style={{ padding: 8, color: 'gray' }}>Dependency graph unavailable</div>}>
        <DependencyGraph nodeIds={nodeIds} edges={edges} height={height} onNodeClick={handleNodeClick} />
      </ErrorBoundary>
    </div>
  );
}

