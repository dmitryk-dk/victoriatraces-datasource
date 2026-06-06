import { groupBy } from 'lodash';
import { DataFrame, Field, FieldType } from '@grafana/data';

/**
 * Converts an array of single-value metric frames (one per series from
 * stats_query / logsql-instant) into one table frame per refId, with label
 * columns expanded. Mirrors VictoriaLogs' makeTableFrames.
 */
export function makeTableFrames(frames: DataFrame[]): DataFrame[] {
  if (frames.length === 0) {
    return [];
  }

  const withRefId = frames.filter((f) => f.refId !== undefined);
  const byRefId = groupBy(withRefId, (f) => f.refId);

  return Object.entries(byRefId).map(([refId, group]) =>
    makeTableFrame(group, refId)
  );
}

function makeTableFrame(frames: DataFrame[], refId: string): DataFrame {
  const timeField: Field = {
    name: 'Time',
    type: FieldType.time,
    config: {},
    values: [],
  };
  const valueField: Field = {
    name: `Value #${refId}`,
    type: FieldType.number,
    config: {},
    values: [],
  };

  // Collect all label names across every frame to build columns.
  const allLabelNames = new Set(
    frames.flatMap((f) =>
      f.fields.flatMap((field) => Object.keys(field.labels ?? {}))
    )
  );
  const sortedLabelNames = Array.from(allLabelNames).sort();

  const labelFields: Field[] = sortedLabelNames.map((name) => ({
    name,
    type: FieldType.string,
    config: { filterable: true },
    values: [],
  }));

  for (const frame of frames) {
    const tf = frame.fields.find((f) => f.type === FieldType.time);
    const vf = frame.fields.find((f) => f.type === FieldType.number);
    if (!tf || !vf) {
      continue;
    }

    for (const t of tf.values as number[]) {
      (timeField.values as number[]).push(t);
    }
    for (const v of vf.values as Array<number | null>) {
      (valueField.values as Array<number | null>).push(v);
    }

    const labels = vf.labels ?? {};
    const count = (vf.values as unknown[]).length;
    for (const lf of labelFields) {
      const text = labels[lf.name] ?? '';
      for (let i = 0; i < count; i++) {
        (lf.values as string[]).push(text);
      }
    }
  }

  return {
    refId,
    length: (timeField.values as unknown[]).length,
    meta: { preferredVisualisationType: 'table' },
    fields: [timeField, ...labelFields, valueField],
  };
}
