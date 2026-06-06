import type { DataFrame } from '@grafana/data';
import type { Trace, TraceKeyValue, TraceLog, TraceProcess, TraceSearchRow, TraceSpan, TraceSpanRef } from '../types';

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {return value;}
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function fieldValues(frame: DataFrame, name: string): unknown[] {
  const field = frame.fields.find((f) => f.name === name);
  return field ? Array.from(field.values) : [];
}

/**
 * Convert a Grafana 'traces' data frame (one row per span) into a Trace object.
 */
export function traceFrameToTrace(frame: DataFrame): Trace | null {
  if (!frame || frame.length === 0) {return null;}

  const traceIDs      = fieldValues(frame, 'traceID') as string[];
  const spanIDs       = fieldValues(frame, 'spanID') as string[];
  const parentSpanIDs = fieldValues(frame, 'parentSpanID') as string[];
  const opNames       = fieldValues(frame, 'operationName') as string[];
  const svcNames      = fieldValues(frame, 'serviceName') as string[];
  const svcTagsRaw    = fieldValues(frame, 'serviceTags');
  const startTimes    = fieldValues(frame, 'startTime') as number[];
  const durations     = fieldValues(frame, 'duration') as number[];
  const tagsRaw       = fieldValues(frame, 'tags');
  const logsRaw       = fieldValues(frame, 'logs');
  const refsRaw       = fieldValues(frame, 'references');

  const processes: Record<string, TraceProcess> = {};
  const spans: TraceSpan[] = [];

  for (let i = 0; i < frame.length; i++) {
    const svcName = svcNames[i] ?? 'unknown';
    const processKey = `p_${svcName.replace(/\s+/g, '_')}`;

    if (!processes[processKey]) {
      const svcTags = parseJsonArray(svcTagsRaw[i]) as TraceKeyValue[];
      processes[processKey] = { serviceName: svcName, tags: svcTags };
    }

    const parentID = parentSpanIDs[i];
    const refs: TraceSpanRef[] = [];
    if (parentID) {
      refs.push({ traceID: traceIDs[i], spanID: parentID, refType: 'CHILD_OF' });
    }
    for (const r of parseJsonArray(refsRaw[i]) as Array<{ traceID: string; spanID: string }>) {
      refs.push({ traceID: r.traceID, spanID: r.spanID, refType: 'FOLLOWS_FROM' });
    }

    const rawLogs = parseJsonArray(logsRaw[i]) as Array<{ timestamp: number; fields: TraceKeyValue[] }>;
    const logs: TraceLog[] = rawLogs.map((l) => ({
      timestamp: l.timestamp,
      fields: Array.isArray(l.fields) ? l.fields : [],
    }));

    spans.push({
      traceID: traceIDs[i],
      spanID: spanIDs[i],
      operationName: opNames[i] ?? '',
      processID: processKey,
      startTime: startTimes[i] ?? 0,
      duration: durations[i] ?? 0,
      references: refs,
      tags: parseJsonArray(tagsRaw[i]) as TraceKeyValue[],
      logs,
    });
  }

  return {
    traceID: spans[0]?.traceID ?? '',
    spans,
    processes,
  };
}

/**
 * Convert a Grafana 'trace_search' data frame (one row per trace) into TraceSearchRow[].
 */
export function searchFrameToRows(frame: DataFrame): TraceSearchRow[] {
  if (!frame || frame.length === 0) {return [];}

  const traceIDs     = fieldValues(frame, 'traceID') as string[];
  const traceNames   = fieldValues(frame, 'traceName') as string[];
  const rootSvcs     = fieldValues(frame, 'rootServiceName') as string[];
  const rootOps      = fieldValues(frame, 'rootTraceName') as string[];
  const startTimes   = fieldValues(frame, 'startTime') as number[];
  const durations    = fieldValues(frame, 'traceDuration') as number[];
  const spanCounts   = fieldValues(frame, 'spanCount') as number[];
  const errorCounts  = fieldValues(frame, 'errorCount') as number[];

  return traceIDs.map((id, i) => ({
    traceID: id,
    traceName: traceNames[i] ?? '',
    rootServiceName: rootSvcs[i] ?? '',
    rootTraceName: rootOps[i] ?? '',
    startTime: startTimes[i] ?? 0,
    traceDuration: durations[i] ?? 0,
    spanCount: spanCounts[i] ?? 0,
    errorCount: errorCounts[i] ?? 0,
  }));
}
