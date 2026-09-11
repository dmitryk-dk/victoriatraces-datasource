import React, { useCallback, useMemo, useState } from 'react';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { ChartView, TraceCharts } from '../trace-ui/components/TraceCharts';
import type { ChartSelection } from '../trace-ui/components/heatmapGrid';
import { TraceChartSelectionEvent } from '../trace-ui/events/chartSelection';
import { drillDurationFilter } from '../trace-ui/filters/chartDrill';
import { addFiltersToQuery, datasourceUidFromData } from '../trace-ui/query/exploreQuery';
import type { VictoriaTracesQuery } from '../types';

const CHARTS_FRAME_NAME = 'trace_charts';

/**
 * The heatmap, scatter plot, operations table and service map, as their own
 * panel.
 *
 * They were part of the trace list panel, which in Explore is a 400px box:
 * charts and table fought over the same few hundred pixels and the table lost.
 * Explore gives every custom panel its own container, so a frame addressed to
 * this plugin buys the charts a second one — and leaves the list its own.
 *
 * The charts fetch what they draw from the resource endpoints, so this panel
 * needs nothing from the frame but the datasource uid and the query the list
 * was built from. Drills are written to the Explore query, which is what makes
 * the list follow; a drawn selection goes over the event bus instead, since it
 * is a preview rather than a change of search.
 */
export function TraceChartsPanel({ data, eventBus, onChangeTimeRange }: PanelProps) {
  const styles = useStyles2(getStyles);
  const [view, setView] = useState<ChartView>('heatmap');
  const [selection, setSelection] = useState<ChartSelection | null>(null);

  const dsUid = datasourceUidFromData(data);
  const target = data.request?.targets?.[0] as VictoriaTracesQuery | undefined;
  const hasFrame = data.series.some((f) => f.name === CHARTS_FRAME_NAME);

  const publishSelection = useCallback(
    (next: ChartSelection | null) => {
      setSelection(next);
      eventBus.publish(new TraceChartSelectionEvent({ selection: next }));
    },
    [eventBus]
  );

  const drillOperation = useCallback(
    (operation: string) => addFiltersToQuery([{ kind: 'operation', value: operation }], new Set(['operation'])),
    []
  );

  // Committing a window is a change of search, not a preview: it moves the
  // time range and narrows the duration filter, so every panel follows.
  const zoomToSelection = useCallback(
    (selected: ChartSelection) => {
      publishSelection(null);
      onChangeTimeRange?.({
        from: Math.floor(selected.startMicros / 1000),
        to: Math.ceil(selected.endMicros / 1000),
      });
      const duration = drillDurationFilter(undefined, selected);
      if (duration) {
        addFiltersToQuery([duration], new Set(['duration']));
      }
    },
    [onChangeTimeRange, publishSelection]
  );

  const where = useMemo(() => target?.where ?? '', [target]);

  if (!hasFrame) {
    return <div className={styles.empty}>Run a trace search to see its charts.</div>;
  }

  return (
    <div className={styles.root}>
      <TraceCharts
        uid={dsUid}
        view={view}
        onViewChange={setView}
        where={where}
        timeRange={data.timeRange}
        rows={[]}
        onDrillOperation={drillOperation}
        selection={selection}
        onSelectionChange={publishSelection}
        onZoom={zoomToSelection}
      />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'auto',
  }),
  empty: css({
    padding: theme.spacing(2),
    color: theme.colors.text.secondary,
  }),
});
