import { DataFrame, FieldType, QueryResultMeta } from '@grafana/data';

/** Returns true when every field is time or number — i.e. a metric frame. */
export function isMetricFrame(frame: DataFrame): boolean {
  return frame.fields.every(
    (f) => f.type === FieldType.time || f.type === FieldType.number
  );
}

/** Shallow-merges new meta onto a frame's existing meta.
 * Preserves the frame's original typeVersion — the backend sets it correctly
 * and overriding it (e.g. to [0,1]) breaks Grafana's schema recognition. */
export function setFrameMeta(frame: DataFrame, meta: QueryResultMeta): DataFrame {
  return {
    ...frame,
    meta: {
      ...frame.meta,
      ...meta,
    },
  };
}

/** Returns true if any row in the labels field contains an __error__ key. */
export function dataFrameHasError(frame: DataFrame): boolean {
  const labelsField = frame.fields.find((f) => f.name === 'labels');
  if (!labelsField) {
    return false;
  }
  return (labelsField.values as Array<Record<string, string>>).some(
    (labels) => labels?.__error__ !== undefined
  );
}
