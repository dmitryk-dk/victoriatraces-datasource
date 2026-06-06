import { useEffect } from 'react';

import { CoreApp } from '@grafana/data';

import { storeKeys } from '../../store/constants';
import store from '../../store/store';

export const EXPLORE_GRAPH_STYLES = {
  LINES: 'lines',
  BARS: 'bars',
  POINTS: 'points',
  STACKED_LINES: 'stacked_lines',
  STACKED_BARS: 'stacked_bars',
} as const;
export type ExploreGraphStyle = (typeof EXPLORE_GRAPH_STYLES)[keyof typeof EXPLORE_GRAPH_STYLES];

/**
 * Sets the default Explore graph style to `bars` when first opening Explore.
 * This matches the VictoriaLogs Explore experience for log volume histograms.
 */
export const useDefaultExploreGraph = (app: CoreApp | undefined, defaultGraph: ExploreGraphStyle) => {
  useEffect(() => {
    if (app === CoreApp.Explore) {
      const graphStyle = store.get(storeKeys.EXPLORE_STYLE_GRAPH);
      if (!graphStyle) {
        store.set(storeKeys.EXPLORE_STYLE_GRAPH, defaultGraph);
      }
    }
  }, [app, defaultGraph]);
};
