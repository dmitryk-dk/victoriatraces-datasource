import { DataFrame, DataFrameType, DataQueryRequest, DataQueryResponse, QueryResultMeta, isDataFrame } from '@grafana/data';

import { DerivedFieldConfig, VictoriaTracesQuery } from '../types';
import { hasVmrangeLabels, processHistogramToHeatmap } from './processHistogram';
import { DatasourceInfo, processLogsFrame } from './processLogsFrame';
import { processRangeFrame } from './processMetricFrame';

/**
 * Main frontend transform pipeline — mirrors VictoriaLogs' transformBackendResult.
 *
 * Groups frames by their origin query type and processes each group:
 *  - logsql-logs  frames → processLogsFrame (meta, detected_level, derived fields)
 *  - logsql       frames → processRangeFrame (graph meta, null-fill)
 *                         → processHistogramToHeatmap (when vmrange labels + heatmap panel)
 *  - logsql-instant frames → passed through as metric frames (individual series per frame)
 *  - everything else → passed through unchanged
 */
export function transformResponse(
  response: DataQueryResponse,
  request: DataQueryRequest<VictoriaTracesQuery>,
  derivedFields: DerivedFieldConfig[],
  datasource?: DatasourceInfo
): DataQueryResponse {
  const queryMap = new Map(
    request.targets.map((q) => [q.refId, q])
  );

  const logsFrames: DataFrame[] = [];
  const rangeFrames: DataFrame[] = [];
  const instantFrames: DataFrame[] = [];
  const otherFrames: DataFrame[] = [];

  for (const raw of response.data) {
    if (!isDataFrame(raw)) {
      otherFrames.push(raw as DataFrame);
      continue;
    }

    const frame = raw as DataFrame;
    const query = queryMap.get(frame.refId ?? '');
    const qt = query?.queryType;

    const isLogsFrame =
      frame.meta?.preferredVisualisationType === 'logs';

    if (isLogsFrame || qt === 'logsql-logs') {
      logsFrames.push(frame);
    } else if (qt === 'logsql') {
      rangeFrames.push(frame);
    } else if (qt === 'logsql-instant') {
      instantFrames.push(frame);
    } else {
      otherFrames.push(frame);
    }
  }

  const startMs = request.range.from.valueOf();
  const endMs = request.range.to.valueOf();

  const isHeatmapPanel = (request as any).panelPluginId === 'heatmap';
  const processedRangeFrames =
    isHeatmapPanel && hasVmrangeLabels(rangeFrames)
      ? processHistogramToHeatmap(rangeFrames)
      : rangeFrames.map((f) => {
          const query = queryMap.get(f.refId ?? '');
          return processRangeFrame(f, query?.step, startMs, endMs);
        });

  const graphMeta: QueryResultMeta = { preferredVisualisationType: 'graph', type: DataFrameType.TimeSeriesMulti };
  const processedInstantFrames = instantFrames.map((f) => ({
    ...f,
    meta: { ...f.meta, ...graphMeta },
  }));

  return {
    ...response,
    data: [
      ...logsFrames.map((f) => processLogsFrame(f, derivedFields, datasource)),
      ...processedRangeFrames,
      ...processedInstantFrames,
      ...otherFrames,
    ],
  };
}
