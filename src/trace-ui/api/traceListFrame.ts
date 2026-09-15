import { DataFrame, FieldType } from '@grafana/data';

import { ATTR_COLUMN_PREFIX, fieldFromAttrColumnKey } from '../filters/traceFields';
import { TraceListRow } from './traceList';

export const TRACE_LIST_FRAME_NAME = 'trace_list';
export const SPAN_LIST_FRAME_NAME = 'span_list';

function parseServices(raw: unknown): string[] {
  if (typeof raw !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Reads the backend's `trace_list` frame into the rows the list renders.
 *
 * The frame is column-oriented and the services set travels as JSON in a single
 * column, since its length varies per trace.
 */
export function traceListFrameToRows(frame: DataFrame): TraceListRow[] {
  const field = (name: string) => frame.fields.find((f) => f.name === name);

  const traceID = field('traceID');
  const rootService = field('rootService');
  const rootOperation = field('rootOperation');
  const services = field('services');
  const startTime = field('startTime');
  const durationMs = field('durationMs');
  const spans = field('spans');
  const errors = field('errors');
  const partial = field('partial');
  const matchedSpanID = field('matchedSpanID');

  if (!traceID) {
    return [];
  }

  // Every column beyond the fixed set is a custom field the query asked for.
  const attrFields = frame.fields.filter((f) => f.name.startsWith(ATTR_COLUMN_PREFIX));

  const rows: TraceListRow[] = [];
  for (let i = 0; i < frame.length; i++) {
    const start = startTime?.values[i];
    rows.push({
      traceID: String(traceID.values[i] ?? ''),
      rootService: String(rootService?.values[i] ?? ''),
      rootOperation: String(rootOperation?.values[i] ?? ''),
      services: parseServices(services?.values[i]),
      // The frame carries a timestamp; the row model is RFC3339 throughout.
      startTime:
        startTime?.type === FieldType.time || typeof start === 'number'
          ? new Date(Number(start)).toISOString()
          : String(start ?? ''),
      durationMicros: Number(durationMs?.values[i] ?? 0) * 1000,
      spans: Number(spans?.values[i] ?? 0),
      errors: Number(errors?.values[i] ?? 0),
      partial: Boolean(partial?.values[i]),
      matchedSpanID: String(matchedSpanID?.values[i] ?? '') || undefined,
      attrs: attrFields.length
        ? Object.fromEntries(
            attrFields.map((f) => [fieldFromAttrColumnKey(f.name), String(f.values[i] ?? '')])
          )
        : undefined,
    });
  }
  return rows;
}

/**
 * Reads the backend's `span_list` frame into the same row shape the list
 * renders, so one table serves both modes. The per-trace aggregates carry
 * zero — the span-mode column set does not show them.
 */
export function spanListFrameToRows(frame: DataFrame): TraceListRow[] {
  const field = (name: string) => frame.fields.find((f) => f.name === name);

  const traceID = field('traceID');
  const spanID = field('spanID');
  const service = field('service');
  const operation = field('operation');
  const startTime = field('startTime');
  const durationMs = field('durationMs');
  const kind = field('kind');
  const statusCode = field('statusCode');

  if (!spanID) {
    return [];
  }

  const attrFields = frame.fields.filter((f) => f.name.startsWith(ATTR_COLUMN_PREFIX));

  const rows: TraceListRow[] = [];
  for (let i = 0; i < frame.length; i++) {
    const svc = String(service?.values[i] ?? '');
    rows.push({
      traceID: String(traceID?.values[i] ?? ''),
      spanID: String(spanID.values[i] ?? ''),
      rootService: svc,
      rootOperation: String(operation?.values[i] ?? ''),
      services: svc ? [svc] : [],
      startTime: new Date(Number(startTime?.values[i] ?? 0)).toISOString(),
      durationMicros: Number(durationMs?.values[i] ?? 0) * 1000,
      spans: 0,
      errors: 0,
      partial: false,
      kind: String(kind?.values[i] ?? ''),
      statusCode: Number(statusCode?.values[i] ?? 0),
      attrs: attrFields.length
        ? Object.fromEntries(
            attrFields.map((f) => [fieldFromAttrColumnKey(f.name), String(f.values[i] ?? '')])
          )
        : undefined,
    });
  }
  return rows;
}
