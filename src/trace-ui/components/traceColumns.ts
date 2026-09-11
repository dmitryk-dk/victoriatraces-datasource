import { attrColumnKey, traceFieldLabel } from '../filters/traceFields';

export interface TraceColumn {
  key: string;
  label: string;
  /** Right-aligned columns are the numeric ones. */
  numeric?: boolean;
}

export const ALL_COLUMNS: readonly TraceColumn[] = [
  { key: 'trace', label: 'Trace ID' },
  { key: 'svcop', label: 'Service > Operation' },
  { key: 'started', label: 'Started at' },
  { key: 'duration', label: 'Duration' },
  { key: 'spans', label: 'Spans', numeric: true },
  { key: 'errors', label: 'Errors', numeric: true },
];

// Spans mode: span count and error count are per-trace aggregates, so they are
// replaced by the span's own identity, kind and status.
export const SPAN_COLUMNS: readonly TraceColumn[] = [
  { key: 'trace', label: 'Trace ID' },
  { key: 'svcop', label: 'Service > Operation' },
  { key: 'started', label: 'Started at' },
  { key: 'duration', label: 'Duration' },
  { key: 'spanId', label: 'Span ID' },
  { key: 'kind', label: 'Kind' },
  { key: 'status', label: 'Status' },
];

export function columnsForEntity(entity: 'traces' | 'spans'): readonly TraceColumn[] {
  return entity === 'spans' ? SPAN_COLUMNS : ALL_COLUMNS;
}

// Relative widths, normalised against whichever columns are visible, so hiding
// one redistributes its space instead of leaving a gap.
const COLUMN_WEIGHT: Record<string, number> = {
  trace: 14,
  svcop: 32,
  started: 20,
  duration: 20,
  spans: 10,
  errors: 10,
  spanId: 14,
  kind: 10,
  status: 10,
};

const DEFAULT_WEIGHT = 14;

export function columnWeight(key: string): number {
  return COLUMN_WEIGHT[key] ?? DEFAULT_WEIGHT;
}

export function defaultWidths(keys: readonly string[]): Record<string, number> {
  const total = keys.reduce((sum, key) => sum + columnWeight(key), 0) || 1;
  return Object.fromEntries(keys.map((key) => [key, columnWeight(key) / total]));
}

/** Builds the column list for a set of custom fields, appended after the fixed ones. */
export function customColumns(fields: readonly string[]): TraceColumn[] {
  return fields.filter(Boolean).map((field) => ({
    key: attrColumnKey(field),
    label: traceFieldLabel(field),
  }));
}

export const HIDDEN_COLUMNS_STORAGE_KEY = 'victoriatraces.traceList.hiddenColumns';

/**
 * Column visibility is a per-user display preference, not query state, so it
 * lives in localStorage rather than the URL. A browser that refuses storage
 * simply shows every column.
 */
export function loadHiddenColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_COLUMNS_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveHiddenColumns(hidden: ReadonlySet<string>): void {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify([...hidden]));
  } catch {
    // Storage disabled; the choice just will not survive a reload.
  }
}
