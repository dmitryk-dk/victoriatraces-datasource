import { DataFrame, DataFrameType } from '@grafana/data';

import { setFrameMeta } from './frameUtils';
import { fillFrameWithNullValues } from './fillNullValues';

/**
 * Processes a stats_query_range (logsql / Range) frame:
 * - Sets preferredVisualisationType: 'graph' + TimeSeriesMulti type
 * - Fills timestamp gaps with null so Grafana draws a continuous line
 *
 * Mirrors VictoriaLogs' processMetricRangeFrames.
 */
export function processRangeFrame(
  frame: DataFrame,
  step: string | undefined,
  startMs: number,
  endMs: number
): DataFrame {
  const filled = fillFrameWithNullValues(frame, step, startMs, endMs);
  return setFrameMeta(filled, {
    preferredVisualisationType: 'graph',
    type: DataFrameType.TimeSeriesMulti,
  });
}
