/** One span of the previewed trace, as fetched for the summary. */
export interface SpanSummary {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly service: string;
  readonly operation: string;
  readonly durationMicros: number;
  readonly startMicros: number;
  readonly error: boolean;
}

export interface ServiceBreakdown {
  readonly service: string;
  /** Self time accumulated in this service (µs) — time its spans spent
      working themselves, excluding time covered by child spans. */
  readonly selfMicros: number;
  readonly spanCount: number;
}

export interface TraceError {
  readonly service: string;
  readonly operation: string;
  /** When the failing span started, relative to the trace start (µs). */
  readonly offsetMicros: number;
}

export interface TraceSummary {
  readonly spanCount: number;
  /** Per-service breakdown, most self time first. */
  readonly services: ServiceBreakdown[];
  /** Error spans in chronological order. */
  readonly errors: TraceError[];
}

/**
 * Self time of each span: its duration minus the time covered by its direct
 * children. Children are merged as intervals (clipped to the parent window)
 * before subtracting, so parallel children aren't double-subtracted. Raw
 * durations double-count — a parent's duration INCLUDES its children — which
 * is how a per-service sum can exceed the whole trace's duration.
 */
export function computeSelfTimes(
  spans: readonly SpanSummary[],
): Map<string, number> {
  const childrenByParent = new Map<string, SpanSummary[]>();
  for (const span of spans) {
    if (!span.parentSpanId) {continue;}
    const bucket = childrenByParent.get(span.parentSpanId);
    if (bucket) {bucket.push(span);}
    else {childrenByParent.set(span.parentSpanId, [span]);}
  }

  const self = new Map<string, number>();
  for (const span of spans) {
    const start = span.startMicros;
    const end = span.startMicros + span.durationMicros;
    // Clip children to the parent window and merge overlaps into a union.
    const intervals = (childrenByParent.get(span.spanId) ?? [])
      .map((c) => ({
        from: Math.max(start, c.startMicros),
        to: Math.min(end, c.startMicros + c.durationMicros),
      }))
      .filter((iv) => iv.to > iv.from)
      .sort((a, b) => a.from - b.from);
    let covered = 0;
    let cursor = start;
    for (const iv of intervals) {
      if (iv.to <= cursor) {continue;}
      covered += iv.to - Math.max(iv.from, cursor);
      cursor = Math.max(cursor, iv.to);
    }
    self.set(span.spanId, Math.max(0, span.durationMicros - covered));
  }
  return self;
}

export function summarizeTrace(spans: readonly SpanSummary[]): TraceSummary {
  const selfTimes = computeSelfTimes(spans);

  const byService = new Map<
    string,
    { selfMicros: number; spanCount: number }
  >();
  let traceStart = Number.POSITIVE_INFINITY;

  for (const span of spans) {
    const selfMicros = selfTimes.get(span.spanId) ?? 0;
    const agg = byService.get(span.service);
    if (agg) {
      agg.selfMicros += selfMicros;
      agg.spanCount += 1;
    } else {
      byService.set(span.service, { selfMicros, spanCount: 1 });
    }
    if (span.startMicros < traceStart) {traceStart = span.startMicros;}
  }

  const services = [...byService.entries()]
    .map(([service, agg]) => ({ service, ...agg }))
    .sort((a, b) => b.selfMicros - a.selfMicros);

  const errors = spans
    .filter((s) => s.error)
    .map((s) => ({
      service: s.service,
      operation: s.operation,
      offsetMicros: Math.max(0, s.startMicros - traceStart),
    }))
    .sort((a, b) => a.offsetMicros - b.offsetMicros);

  return { spanCount: spans.length, services, errors };
}
