import type { Trace as PanelTrace, TraceSpan as PanelSpan } from '../../panel/types';
import type { Trace } from '../types/trace';

/**
 * Adapts a Jaeger-shaped trace from the datasource into the panel's trace
 * model, so the app page and the panel render the same waterfall.
 *
 * The only real difference is the time unit: the Jaeger API reports
 * microseconds, the panel works in milliseconds.
 */
export function toPanelTrace(trace: Trace): PanelTrace {
  const spans: PanelSpan[] = trace.spans.map((span) => ({
    traceID: span.traceID,
    spanID: span.spanID,
    operationName: span.operationName,
    processID: span.processID,
    startTime: span.startTime / 1000,
    duration: span.duration / 1000,
    references: span.references.map((ref) => ({
      traceID: ref.traceID,
      spanID: ref.spanID,
      refType: ref.refType,
    })),
    tags: span.tags.map((tag) => ({ key: tag.key, value: tag.value, type: tag.type })),
    logs: (span.logs ?? []).map((log) => ({
      timestamp: log.timestamp / 1000,
      fields: log.fields.map((f) => ({ key: f.key, value: f.value, type: f.type })),
    })),
    warnings: span.warnings,
  }));

  return {
    traceID: trace.traceID,
    spans,
    processes: Object.fromEntries(
      Object.entries(trace.processes).map(([id, process]) => [
        id,
        {
          serviceName: process.serviceName,
          tags: process.tags.map((tag) => ({ key: tag.key, value: tag.value, type: tag.type })),
        },
      ])
    ),
  };
}
