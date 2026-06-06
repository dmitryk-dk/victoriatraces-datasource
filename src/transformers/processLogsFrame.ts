import { DataFrame, DataLink, Field, FieldType } from '@grafana/data';

import { DerivedFieldConfig } from '../types';
import { applyDerivedFields } from './derivedFields';
import { dataFrameHasError, setFrameMeta } from './frameUtils';
import { FrameField } from './types';

/** Datasource identity needed to build internal "View Trace" links. */
export interface DatasourceInfo {
  uid: string;
  name: string;
}

/**
 * Safely converts a single label-field value into a Record.
 * Handles both:
 *  - Already-parsed JavaScript objects (Grafana ≥ 10.3)
 *  - Raw JSON strings from Arrow binary deserialization
 */
export function parseLabelsValue(raw: unknown): Record<string, string> | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // not valid JSON
    }
  }
  return null;
}

/**
 * Returns an array of parsed label objects from a labels field,
 * handling both pre-parsed objects and JSON strings.
 */
function getLabelsArray(labelsField: Field): Array<Record<string, string> | null> {
  const len = labelsField.values.length;
  const result: Array<Record<string, string> | null> = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = parseLabelsValue(labelsField.values[i]);
  }
  return result;
}

/**
 * Enriches a raw logs frame returned by the Go backend:
 * 1. Sets the correct meta (British spelling, streamIds for log context)
 * 2. Adds a `detected_level` field for Grafana's log-level coloring
 * 3. Applies derived fields (e.g. traceID → clickable link)
 * 4. Adds a clickable `traceID` field extracted from labels
 *
 * Mirrors VictoriaLogs' processStreamFrame.
 */
export function processLogsFrame(
  frame: DataFrame,
  derivedFields: DerivedFieldConfig[],
  datasource?: DatasourceInfo
): DataFrame {
  const custom: Record<string, unknown> = { ...(frame.meta?.custom as object | undefined) };

  if (dataFrameHasError(frame)) {
    custom.error = 'Error when parsing some of the log records';
  }

  // Collect _stream_id values from labels so Grafana can power Log Context.
  const labelsField = frame.fields.find((f) => f.name === FrameField.Labels);
  const allLabels = labelsField ? getLabelsArray(labelsField) : [];
  const streamIds = allLabels.map((l) => l?._stream_id);

  const withMeta = setFrameMeta(frame, {
    // Use the British spelling — this is what Grafana's Logs panel reads in TS.
    preferredVisualisationType: 'logs',
    custom: { ...custom, streamIds },
  });

  const withLine = enrichLineField(withMeta);
  const withLevel = addDetectedLevelField(withLine);
  const withDerived = applyDerivedFields(withLevel, derivedFields);

  return datasource ? addTraceIdLink(withDerived, datasource) : withDerived;
}

/**
 * Replaces placeholder `"-"` Line values with a human-readable span summary
 * built from the labels JSON of each row.
 *
 * VictoriaTraces sets Line="-" for all span records because spans have no
 * natural "log message" body. We reconstruct one from the span operation name,
 * service name, and key identifiers so the Grafana Logs panel is readable.
 */
function enrichLineField(frame: DataFrame): DataFrame {
  const lineField = frame.fields.find((f) => f.name === FrameField.Line);
  const labelsField = frame.fields.find((f) => f.name === FrameField.Labels);

  if (!lineField || !labelsField) {
    return frame;
  }

  const lines = lineField.values as string[];
  const allLabels = getLabelsArray(labelsField);

  // Only rewrite rows that still have the placeholder value.
  const enriched = lines.map((line, i) => {
    if (line !== '-' && line !== '') {
      return line;
    }
    return buildSpanLine(allLabels[i] ?? {});
  });

  return {
    ...frame,
    fields: frame.fields.map((f) =>
      f.name === FrameField.Line ? { ...f, values: enriched } : f
    ),
  };
}

/**
 * Builds a readable one-line summary for a span (or index / service-graph row).
 *
 * Span rows:     `resolveAnyValue  service="flagd"  trace=c568… span=c1b9…  2.16ms`
 * Index rows:    `trace_index  trace_id=c568…`
 * SvcGraph rows: `service_graph  frontend → frontend-proxy  calls=26`
 */
function buildSpanLine(labels: Record<string, string>): string {
  const name = labels['name'];
  const service = labels['resource_attr:service.name'];

  // Regular span row.
  if (name || service) {
    const parts: string[] = [];
    if (name) {
      parts.push(name);
    }
    if (service) {
      parts.push(`service="${service}"`);
    }
    if (labels['trace_id']) {
      parts.push(`trace=${labels['trace_id'].slice(0, 16)}`);
    }
    if (labels['span_id']) {
      parts.push(`span=${labels['span_id']}`);
    }
    const durationNs = parseInt(labels['duration'] ?? '0', 10);
    if (durationNs > 0) {
      parts.push(`${(durationNs / 1_000_000).toFixed(3)}ms`);
    }
    return parts.join('  ');
  }

  // Trace index row.
  if (labels['trace_id_idx']) {
    return `trace_index  trace_id=${labels['trace_id_idx']}`;
  }

  // Service-graph row.
  if (labels['trace_service_graph_stream'] !== undefined) {
    const parent = labels['parent'] ?? '';
    const child = labels['child'] ?? '';
    const calls = labels['callCount'] ?? '';
    return `service_graph  ${parent} → ${child}  calls=${calls}`;
  }

  // Fallback.
  return JSON.stringify(labels).slice(0, 200);
}

/**
 * Adds a `detected_level` string field by inspecting common level indicators
 * in the labels JSON of each row. Grafana's Logs panel uses this field name
 * to color-code entries.
 */
function addDetectedLevelField(frame: DataFrame): DataFrame {
  const labelsField = frame.fields.find((f) => f.name === FrameField.Labels);
  const lineField = frame.fields.find((f) => f.name === FrameField.Line);
  const rows = frame.fields[0]?.values.length ?? 0;
  const parsedLabels = labelsField ? getLabelsArray(labelsField) : [];

  const levels = Array.from({ length: rows }, (_, i) => {
    const labels = parsedLabels[i] ?? {};
    const line: string =
      (lineField?.values as string[])?.[i] ?? '';
    return detectLevel(labels, line);
  });

  const levelField: Field = {
    name: FrameField.DetectedLevel,
    type: FieldType.string,
    config: {},
    values: levels,
  };

  return { ...frame, fields: [...frame.fields, levelField] };
}

/**
 * Infers a log level string from labels and the log line text.
 * Returns one of: 'critical' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | ''
 */
function detectLevel(
  labels: Record<string, string>,
  line: string
): string {
  // Prefer explicit level labels that VictoriaTraces / OTel might set.
  const explicit =
    labels['detected_level'] ??
    labels['level'] ??
    labels['severity'] ??
    labels['log.level'] ??
    labels['span_attr:level'] ??
    '';

  if (explicit) {
    return normalizeLevel(explicit);
  }

  // Fall back to scanning the log line for keywords.
  const lower = line.toLowerCase();
  for (const [keyword, level] of LEVEL_KEYWORDS) {
    if (lower.includes(keyword)) {
      return level;
    }
  }

  return '';
}

const LEVEL_KEYWORDS: [string, string][] = [
  ['critical', 'critical'],
  ['fatal', 'critical'],
  ['error', 'error'],
  ['err', 'error'],
  ['warn', 'warn'],
  ['warning', 'warn'],
  ['info', 'info'],
  ['debug', 'debug'],
  ['trace', 'trace'],
];

function normalizeLevel(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'fatal') {
    return 'critical';
  }
  if (lower === 'warning') {
    return 'warn';
  }
  return lower;
}

/**
 * Extracts `trace_id` from every row's labels and appends a `traceID` field
 * with an internal data link that opens the trace in the VictoriaTraces panel.
 *
 * Rows without a `trace_id` label get a null value and no link is rendered.
 */
function addTraceIdLink(frame: DataFrame, datasource: DatasourceInfo): DataFrame {
  const labelsField = frame.fields.find((f) => f.name === FrameField.Labels);
  if (!labelsField) {
    return frame;
  }

  if (frame.fields.some((f) => f.name === 'traceID')) {
    return frame;
  }

  const parsedLabels = getLabelsArray(labelsField);
  const values: Array<string | null> = parsedLabels.map((labels) =>
    labels?.['trace_id'] ?? labels?.['traceID'] ?? labels?.['traceId'] ?? null
  );

  if (!values.some((v) => v !== null)) {
    return frame;
  }

  const link: DataLink = {
    title: '${__value.raw}',
    url: '',
    internal: {
      query: { queryType: 'traceId', traceId: '${__value.raw}' },
      datasourceUid: datasource.uid,
      datasourceName: datasource.name,
    },
  };

  const traceIdField: Field = {
    name: 'traceID',
    type: FieldType.string,
    config: { links: [link] },
    values,
  };

  return { ...frame, fields: [...frame.fields, traceIdField] };
}
