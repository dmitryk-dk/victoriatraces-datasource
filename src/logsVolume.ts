import { from, isObservable, Observable } from 'rxjs';

import {
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  FieldColorModeId,
  FieldConfig,
  FieldType,
  LoadingState,
  LogLevel,
  MutableDataFrame,
  toDataFrame,
} from '@grafana/data';

import { VictoriaTracesQuery } from './types';

export const LOGS_VOLUME_BARS = 100;

/** Colour map for log levels — matches VictoriaLogs. */
const LOG_LEVEL_COLOR: Record<string, string> = {
  [LogLevel.critical]: '#FF0010',
  [LogLevel.error]: '#F2495C',
  [LogLevel.warning]: '#FF9830',
  [LogLevel.info]: '#5794F2',
  [LogLevel.debug]: '#56A64B',
  [LogLevel.trace]: '#6E9FFF',
  [LogLevel.unknown]: '#8e8e8e',
};

/**
 * Wraps a datasource query for the Logs volume supplementary request,
 * then aggregates the resulting hits frames into stacked-bar
 * per-level DataFrames for the Explore histogram panel.
 *
 * Mirrors VictoriaLogs' queryLogsVolume.
 */
export const queryLogsVolume = (
  datasource: { query: (req: any) => Observable<DataQueryResponse> },
  request: DataQueryRequest<VictoriaTracesQuery>
): Observable<DataQueryResponse> => {
  return new Observable((observer) => {
    let rawLogsVolume: DataFrame[] = [];
    observer.next({
      state: LoadingState.Loading,
      error: undefined,
      data: [],
    });

    const queryResponse = datasource.query(request);
    const queryObservable = isObservable(queryResponse) ? queryResponse : from(queryResponse);

    const subscription = queryObservable.subscribe({
      complete: () => {
        const aggregatedLogsVolume = aggregateRawLogsVolume(rawLogsVolume, request);
        if (aggregatedLogsVolume[0]) {
          aggregatedLogsVolume[0].meta = {
            custom: {
              targets: request.targets,
              absoluteRange: { from: request.range.from.valueOf(), to: request.range.to.valueOf() },
            },
          };
        }
        observer.next({
          state: LoadingState.Done,
          error: undefined,
          data: aggregatedLogsVolume,
        });
        observer.complete();
      },
      next: (dataQueryResponse: DataQueryResponse) => {
        const { error } = dataQueryResponse;
        if (error !== undefined) {
          observer.next({
            state: LoadingState.Error,
            error,
            data: [],
          });
          observer.error(error);
        } else {
          rawLogsVolume = rawLogsVolume.concat(dataQueryResponse.data.map(toDataFrame));
        }
      },
      error: (error) => {
        observer.next({
          state: LoadingState.Error,
          error: error,
          data: [],
        });
        observer.error(error);
      },
    });
    return () => {
      subscription?.unsubscribe();
    };
  });
};

/**
 * Extracts the effective log level from a DataFrame's Value field labels.
 * Mirrors VictoriaLogs' extractLevel.
 */
function extractLevel(frame: DataFrame): LogLevel {
  const valueField = frame.fields.find((f) => f.name === 'Value');
  if (!valueField?.labels) {
    return LogLevel.unknown;
  }

  const labels = valueField.labels;
  const raw =
    labels['level'] ??
    labels['detected_level'] ??
    labels['severity'] ??
    '';

  if (!raw) {
    return LogLevel.unknown;
  }

  const lower = raw.toLowerCase();
  const isValid = Object.keys(LogLevel).includes(lower as LogLevel);
  return isValid ? (lower as LogLevel) : LogLevel.unknown;
}

/**
 * Take multiple data frames, sum up values and group by level.
 * Return a list of data frames, each representing single level.
 *
 * Mirrors VictoriaLogs' aggregateRawLogsVolume.
 */
function aggregateRawLogsVolume(
  rawLogsVolume: DataFrame[],
  request: DataQueryRequest<VictoriaTracesQuery>
): DataFrame[] {
  const logsVolumeByLevelMap: Partial<Record<LogLevel, DataFrame[]>> = {};

  rawLogsVolume.forEach((dataFrame) => {
    const level = extractLevel(dataFrame);
    if (!logsVolumeByLevelMap[level]) {
      logsVolumeByLevelMap[level] = [];
    }
    logsVolumeByLevelMap[level]!.push(dataFrame);
  });

  return Object.keys(logsVolumeByLevelMap).map((level: string) => {
    return aggregateFields(
      logsVolumeByLevelMap[level as LogLevel]!,
      getLogVolumeFieldConfig(level as LogLevel),
      request
    );
  });
}

/**
 * Aggregate multiple data frames into a single data frame by adding values.
 * Multiple data frames for the same level are passed here to get a single
 * data frame for a given level.
 *
 * Mirrors VictoriaLogs' aggregateFields.
 */
function aggregateFields(
  dataFrames: DataFrame[],
  config: FieldConfig,
  request: DataQueryRequest<VictoriaTracesQuery>
): DataFrame {
  const aggregatedDataFrame = new MutableDataFrame();
  if (!dataFrames.length) {
    return aggregatedDataFrame;
  }

  const totalSeconds = request.range.to.diff(request.range.from, 'second');
  const step = Math.ceil(totalSeconds / LOGS_VOLUME_BARS) || 1;
  const uniqTimes = Array.from(
    { length: LOGS_VOLUME_BARS },
    (_, i) => request.range.from.valueOf() + i * step * 1000
  );
  const totalLength = uniqTimes.length;

  if (!totalLength) {
    return aggregatedDataFrame;
  }

  aggregatedDataFrame.addField({ name: 'Time', type: FieldType.time }, totalLength);
  aggregatedDataFrame.addField({ name: 'Value', type: FieldType.number, config }, totalLength);

  for (let pointIndex = 0; pointIndex < totalLength; pointIndex++) {
    const time = uniqTimes[pointIndex];
    const value = dataFrames.reduce((acc, frame) => {
      const [frameTimes, frameValues] = frame.fields;
      const targetIndex = frameTimes.values.findIndex((t: number) => Math.abs(t - time) < (step * 1000) / 2);
      return acc + (targetIndex !== -1 ? frameValues.values[targetIndex] : 0);
    }, 0);
    aggregatedDataFrame.set(pointIndex, { Value: value, Time: time });
  }

  return aggregatedDataFrame;
}

/**
 * Returns field configuration used to render logs volume bars.
 * Mirrors VictoriaLogs' getLogVolumeFieldConfig.
 */
function getLogVolumeFieldConfig(level: LogLevel): FieldConfig {
  const name = level;
  const color = LOG_LEVEL_COLOR[name] ?? LOG_LEVEL_COLOR[LogLevel.unknown];
  return {
    displayNameFromDS: name,
    color: {
      mode: FieldColorModeId.Fixed,
      fixedColor: color,
    },
    custom: {
      drawStyle: 'bars',
      barAlignment: 0,
      lineColor: color,
      pointColor: color,
      fillColor: color,
      lineWidth: 1,
      fillOpacity: 100,
      stacking: {
        mode: 'normal',
        group: 'A',
      },
    },
  };
}

/**
 * Computes the step duration string for a Logs volume query:
 * divides the total time range into LOGS_VOLUME_BARS equal buckets.
 * Returns a Prometheus duration string like "30s".
 */
export function getLogsVolumeStep(fromMs: number, toMs: number): string {
  const totalSeconds = Math.ceil((toMs - fromMs) / 1000);
  const stepSeconds = Math.max(1, Math.ceil(totalSeconds / LOGS_VOLUME_BARS));
  return `${stepSeconds}s`;
}

/**
 * Extracts the filter portion of a LogsQL expression (everything before the
 * first `|`).  Used to strip aggregate pipes before re-using the filter in
 * the volume histogram query.
 */
export function extractLogsQLFilter(expr: string): string {
  const pipeIdx = expr.indexOf('|');
  return pipeIdx >= 0 ? expr.slice(0, pipeIdx).trim() || '*' : expr.trim() || '*';
}
