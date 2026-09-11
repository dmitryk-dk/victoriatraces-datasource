import React, { useMemo, useState } from "react";
import { GrafanaTheme2, SelectableValue, TimeRange } from "@grafana/data";
import {
  Alert,
  IconButton,
  LoadingPlaceholder,
  RadioButtonGroup,
  useStyles2,
} from "@grafana/ui";
import { css } from "@emotion/css";

import { DependencyGraph } from "../../panel/components/DependencyGraph";
import {
  TraceListRow,
  useHeatmap,
  useOperationStats,
  useTraceSample,
} from "../api/traceList";
import { useDependencies, useServices } from "../api/traces";
import { OperationsOverview } from "./OperationsOverview";
import { TracesHeatmap } from "./TracesHeatmap";
import { TracesScatterPlot } from "./TracesScatterPlot";
import type { ChartSelection } from "./heatmapGrid";

/** Sample size for the scatter plot, as visum's DEFAULT_SCATTER_LIMIT. */
const SCATTER_LIMIT = 1000;

export type ChartView =
  "heatmap" | "scatter" | "operations" | "serviceMap" | "none";

export const CHART_OPTIONS: Array<SelectableValue<ChartView>> = [
  { label: "Heatmap", value: "heatmap", icon: "gf-grid" },
  { label: "Scatter", value: "scatter", icon: "chart-line" },
  { label: "Operations", value: "operations", icon: "list-ul" },
  { label: "Service map", value: "serviceMap", icon: "sitemap" },
];

interface Props {
  uid?: string;
  view: ChartView;
  onViewChange: (view: ChartView) => void;
  where: string;
  timeRange: TimeRange;
  rows: TraceListRow[];
  onSelectTrace?: (row: TraceListRow) => void;
  selectedTraceId?: string;
  /** Drill from a chart into the trace list's filters. */
  onDrillOperation?: (operation: string) => void;
  /** Time × duration window shared by the heatmap and the scatter plot. */
  selection?: ChartSelection | null;
  onSelectionChange?: (selection: ChartSelection | null) => void;
  /** Commit the selection as the view's own range. */
  onZoom?: (selection: ChartSelection) => void;
}

export function TraceCharts({
  uid,
  view,
  onViewChange,
  where,
  timeRange,
  rows,
  onSelectTrace,
  selectedTraceId,
  onDrillOperation,
  selection,
  onSelectionChange,
  onZoom,
}: Props) {
  const styles = useStyles2(getStyles);

  const startMs = timeRange.from.valueOf();
  const endMs = timeRange.to.valueOf();
  const startIso = useMemo(() => timeRange.from.toISOString(), [timeRange]);
  const endIso = useMemo(() => timeRange.to.toISOString(), [timeRange]);

  // Each chart only queries while it is the one on screen.
  const heatmap = useHeatmap(
    view === "heatmap" ? uid : undefined,
    where,
    startIso,
    endIso,
    startMs,
    endMs,
  );
  // The operations table is service-scoped; default to the busiest service in
  // the loaded rows so the view is useful before anything is picked.
  const serviceList = useServices(view === "operations" ? uid : undefined);
  const [operationsService, setOperationsService] = useState<
    string | undefined
  >();
  const effectiveService = operationsService ?? rows[0]?.rootService;
  const operationStats = useOperationStats(
    view === "operations" ? uid : undefined,
    effectiveService,
    startIso,
    endIso,
  );

  // The scatter plot samples the whole range itself rather than drawing the
  // page of rows the table happens to hold, so paging the table cannot change
  // what the chart shows.
  const scatter = useTraceSample(
    view === "scatter" ? uid : undefined,
    where,
    startIso,
    endIso,
    SCATTER_LIMIT,
  );

  const dependencies = useDependencies(
    view === "serviceMap" ? uid : undefined,
    endMs,
    Math.max(endMs - startMs, 1),
  );

  const graph = useMemo(() => {
    const edges = (dependencies.data ?? []).map((d) => ({
      source: d.parent,
      target: d.child,
      callCount: d.callCount,
    }));
    const nodeIds = [...new Set(edges.flatMap((e) => [e.source, e.target]))];
    return { nodeIds, edges };
  }, [dependencies.data]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        {view !== "none" && (
          <RadioButtonGroup
            options={CHART_OPTIONS}
            value={view}
            onChange={onViewChange}
            size="sm"
          />
        )}
        <IconButton
          name={view === "none" ? "eye-slash" : "eye"}
          tooltip={view === "none" ? "Show chart" : "Hide chart"}
          aria-label={view === "none" ? "Show chart" : "Hide chart"}
          onClick={() => onViewChange(view === "none" ? "heatmap" : "none")}
        />
      </div>

      <div className={styles.body}>
        {view === "heatmap" && (
          <>
            {heatmap.loading && !heatmap.data && (
              <LoadingPlaceholder text="Loading heatmap…" />
            )}
            {heatmap.error && (
              <Alert title="Could not load the heatmap" severity="warning">
                {heatmap.error.message}
              </Alert>
            )}
            {heatmap.data && (
              <TracesHeatmap
                data={heatmap.data}
                selection={selection}
                onSelectionChange={onSelectionChange}
              />
            )}
          </>
        )}

        {view === "scatter" && (
          <>
            {scatter.loading && scatter.rows.length === 0 && (
              <LoadingPlaceholder text="Sampling traces…" />
            )}
            {scatter.error && (
              <Alert title="Could not load the scatter plot" severity="warning">
                {scatter.error.message}
              </Alert>
            )}
            {!scatter.loading && (
              <TracesScatterPlot
                rows={scatter.rows}
                startMs={startMs}
                endMs={endMs}
                total={scatter.total}
                onSelect={onSelectTrace}
                selectedTraceId={selectedTraceId}
                selection={selection}
                onSelectionChange={onSelectionChange}
                onZoom={onZoom}
              />
            )}
          </>
        )}

        {view === "operations" && (
          <OperationsOverview
            services={serviceList.data ?? []}
            service={effectiveService}
            onServiceChange={setOperationsService}
            stats={operationStats.data?.stats ?? []}
            truncated={operationStats.data?.truncated}
            loading={operationStats.loading}
            error={operationStats.error}
            onSelectOperation={onDrillOperation}
          />
        )}

        {view === "serviceMap" && (
          <>
            {dependencies.loading && !dependencies.data && (
              <LoadingPlaceholder text="Loading service map…" />
            )}
            {dependencies.error && (
              <Alert title="Could not load the service map" severity="warning">
                {dependencies.error.message}
              </Alert>
            )}
            {dependencies.data &&
              (graph.nodeIds.length > 0 ? (
                <DependencyGraph
                  nodeIds={graph.nodeIds}
                  edges={graph.edges}
                  height={260}
                />
              ) : (
                <div className={styles.empty}>
                  No service dependencies recorded for this range.
                  VictoriaTraces builds this graph from cross-service calls.
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
    // The charts own their panel, so they take its height.
    flex: 1,
    minHeight: 0,
  }),
  graph: css({
    flex: 1,
    minHeight: 200,
  }),
  body: css({
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  }),
  toolbar: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing(1),
  }),
  empty: css({
    padding: theme.spacing(2),
    textAlign: "center",
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
