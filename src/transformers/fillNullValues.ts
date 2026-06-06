import { DataFrame, FieldType } from '@grafana/data';

/**
 * Fills gaps in a time-series frame with null values so Grafana draws a
 * continuous graph rather than connecting distant points.
 * Mirrors VictoriaLogs' fillFrameWithNullValues.
 *
 * @param step  Step string in Prometheus duration format, e.g. "30s", "5m".
 *              When undefined the frame is returned unchanged.
 */
export function fillFrameWithNullValues(
  frame: DataFrame,
  step: string | undefined,
  startMs: number,
  endMs: number
): DataFrame {
  if (!step) {
    return frame;
  }

  const stepMs = parseDurationMs(step);
  if (stepMs <= 0) {
    return frame;
  }

  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  const valueField = frame.fields.find((f) => f.type === FieldType.number);
  if (!timeField || !valueField) {
    return frame;
  }

  const existing = timeField.values as number[];
  const firstTs = existing[0];
  if (firstTs === undefined) {
    return frame;
  }

  // Generate the full expected timestamp grid.
  const timestamps = generateTimestamps(firstTs, startMs, endMs, stepMs);

  // Build a map from timestamp → value for O(1) lookup.
  const tsToValue = new Map<number, number | null>();
  for (let i = 0; i < existing.length; i++) {
    tsToValue.set(existing[i], (valueField.values as Array<number | null>)[i] ?? null);
  }

  const filledValues = timestamps.map((t) => tsToValue.get(t) ?? null);

  return {
    ...frame,
    fields: [
      { ...timeField, values: timestamps },
      { ...valueField, values: filledValues },
    ],
  };
}

function generateTimestamps(
  firstTs: number,
  startMs: number,
  endMs: number,
  stepMs: number
): number[] {
  const stepsBack = Math.ceil((startMs - firstTs) / stepMs);
  let cursor = firstTs + stepsBack * stepMs;
  if (cursor < startMs) {
    cursor = startMs;
  }

  const result: number[] = [];
  while (cursor <= endMs) {
    result.push(cursor);
    cursor += stepMs;
  }
  return result;
}

/** Parses a Prometheus duration string into milliseconds. */
function parseDurationMs(s: string): number {
  const units: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };

  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|[smhdwy])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s)) !== null) {
    total += parseFloat(match[1]) * (units[match[2]] ?? 0);
  }
  return total;
}
