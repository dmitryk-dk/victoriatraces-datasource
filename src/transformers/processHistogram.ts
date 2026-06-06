import { DataFrame, DataFrameType, FieldType } from '@grafana/data';

interface ParsedBucket {
  yMin: number;
  yMax: number;
  timestamps: number[];
  values: Array<number | null>;
}

const IGNORED_LABELS = new Set(['vmrange', '__name__']);

function parseBucketFromFrame(frame: DataFrame): ParsedBucket | null {
  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  const valueField = frame.fields.find((f) => f.type === FieldType.number);
  if (!timeField || !valueField) {
    return null;
  }
  const vmrange = valueField.labels?.vmrange;
  if (!vmrange) {
    return null;
  }
  const [minStr, maxStr] = vmrange.split('...');
  const yMin = parseFloat(minStr);
  const yMax = parseFloat(maxStr);
  if (isNaN(yMin) || isNaN(yMax)) {
    return null;
  }
  return {
    yMin,
    yMax,
    timestamps: timeField.values as number[],
    values: valueField.values as Array<number | null>,
  };
}

function getLabelGroupKey(labels: Record<string, string> | undefined): string {
  if (!labels) {
    return '';
  }
  return Object.keys(labels)
    .filter((k) => !IGNORED_LABELS.has(k))
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function groupFramesByLabels(frames: DataFrame[]): Map<string, DataFrame[]> {
  const groups = new Map<string, DataFrame[]>();
  for (const frame of frames) {
    const valueField = frame.fields.find((f) => f.type === FieldType.number);
    const key = getLabelGroupKey(valueField?.labels);
    const group = groups.get(key);
    if (group) {
      group.push(frame);
    } else {
      groups.set(key, [frame]);
    }
  }
  return groups;
}

function buildHeatmapFrame(frames: DataFrame[]): DataFrame {
  const buckets: ParsedBucket[] = [];
  for (const frame of frames) {
    const bucket = parseBucketFromFrame(frame);
    if (bucket) {
      buckets.push(bucket);
    }
  }
  buckets.sort((a, b) => a.yMin - b.yMin);

  const timestampSet = new Set<number>();
  const bucketTimestampMaps: Array<Map<number, number>> = [];
  for (const bucket of buckets) {
    const tsMap = new Map<number, number>();
    bucket.timestamps.forEach((ts, idx) => {
      timestampSet.add(ts);
      tsMap.set(ts, idx);
    });
    bucketTimestampMaps.push(tsMap);
  }
  const timestamps = [...timestampSet].sort((a, b) => a - b);
  const intervalMs = timestamps.length > 1 ? timestamps[1] - timestamps[0] : 60000;

  const xMaxValues: number[] = [];
  const yMinValues: number[] = [];
  const yMaxValues: number[] = [];
  const countValues: Array<number | null> = [];
  for (const ts of timestamps) {
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      const idx = bucketTimestampMaps[i].get(ts);
      xMaxValues.push(ts);
      yMinValues.push(bucket.yMin);
      yMaxValues.push(bucket.yMax);
      countValues.push(idx !== undefined ? bucket.values[idx] : 0);
    }
  }

  return {
    length: xMaxValues.length,
    meta: {
      type: DataFrameType.HeatmapCells,
    },
    fields: [
      {
        name: 'xMax',
        type: FieldType.time,
        config: { interval: intervalMs },
        values: xMaxValues,
      },
      {
        name: 'yMin',
        type: FieldType.number,
        config: {},
        values: yMinValues,
      },
      {
        name: 'yMax',
        type: FieldType.number,
        config: {},
        values: yMaxValues,
      },
      {
        name: 'count',
        type: FieldType.number,
        config: {},
        values: countValues,
      },
    ],
  };
}

export function hasVmrangeLabels(frames: DataFrame[]): boolean {
  return frames.some((frame) => {
    const valueField = frame.fields.find((f) => f.type === FieldType.number);
    return valueField?.labels?.vmrange !== undefined;
  });
}

export function processHistogramToHeatmap(frames: DataFrame[]): DataFrame[] {
  if (frames.length === 0) {
    return [];
  }

  const groups = groupFramesByLabels(frames);
  const result: DataFrame[] = [];
  for (const groupFrames of groups.values()) {
    result.push(buildHeatmapFrame(groupFrames));
  }
  return result;
}
