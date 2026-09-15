import { computeCriticalPath } from './criticalPath';
import type { SpanLike } from './spanLike';
import type { SpanSummary } from './traceSummary';

export interface CriticalSpan {
  readonly span: SpanSummary;
  /** Total time this span spends on the trace's critical path (µs). */
  readonly criticalMicros: number;
}

/**
 * The span that owns the largest share of the trace's critical path — the
 * chain of spans that actually gated the trace's end-to-end duration
 * (same algorithm as the waterfall's critical-path overlay).
 */
export function findCriticalSpan(
  spans: readonly SpanSummary[],
): CriticalSpan | undefined {
  if (spans.length === 0) {return undefined;}

  // Adapt the summary projection to the Span shape the algorithm walks.
  const adapted: SpanLike[] = spans.map((s) => ({
    spanID: s.spanId,
    traceID: '',
    startTime: s.startMicros,
    duration: s.durationMicros,
    references: s.parentSpanId
      ? [{ refType: 'CHILD_OF' as const, spanID: s.parentSpanId, traceID: '' }]
      : [],
  }));

  const segments = computeCriticalPath(adapted);
  const bySpanId = new Map(spans.map((s) => [s.spanId, s]));

  let best: CriticalSpan | undefined;
  for (const [spanId, segs] of segments) {
    const span = bySpanId.get(spanId);
    if (!span) {continue;}
    const criticalMicros = segs.reduce(
      (sum, seg) => sum + (seg.end - seg.start),
      0,
    );
    if (
      !best ||
      criticalMicros > best.criticalMicros ||
      // Tie-break on the earlier-starting span for a stable pick.
      (criticalMicros === best.criticalMicros &&
        span.startMicros < best.span.startMicros)
    ) {
      best = { span, criticalMicros };
    }
  }
  return best;
}
