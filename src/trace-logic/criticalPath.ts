import type { SpanLike } from './spanLike';

/** A span time-segment (absolute µs) that lies on the trace's critical path. */
export interface CriticalSegment {
  /** Absolute start time, microseconds. */
  readonly start: number;
  /** Absolute end time, microseconds. */
  readonly end: number;
}

// Guards runaway recursion on pathologically deep traces (real traces are
// shallow; a linear chain this deep would be malformed).
const MAX_DEPTH = 10_000;

/**
 * The span owning the largest share of the critical path — the single span
 * worth optimising, and the one the trace overview names as its critical span.
 * Nearly every ancestor in a deep trace carries some critical segment, so
 * marking them all says almost nothing; this marks the one that matters.
 */
export function heaviestCriticalSpanId(
  path: ReadonlyMap<string, CriticalSegment[]>
): string | undefined {
  let winner: string | undefined;
  let best = 0;
  for (const [spanId, segments] of path) {
    const micros = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    if (micros > best) {
      best = micros;
      winner = spanId;
    }
  }
  return winner;
}

export function computeCriticalPath(
  spans: readonly SpanLike[],
): Map<string, CriticalSegment[]> {
  const out = new Map<string, CriticalSegment[]>();
  if (spans.length === 0) {return out;}

  const byId = new Map<string, SpanLike>();
  for (const s of spans) {byId.set(s.spanID, s);}

  // CHILD_OF children present in this trace, bucketed per parent (O(n)).
  const childrenByParent = new Map<string, string[]>();
  for (const s of spans) {
    for (const ref of s.references) {
      if (ref.refType === 'CHILD_OF' && byId.has(ref.spanID)) {
        const bucket = childrenByParent.get(ref.spanID);
        if (bucket) {bucket.push(s.spanID);}
        else {childrenByParent.set(ref.spanID, [s.spanID]);}
      }
    }
  }

  // Root = a span whose CHILD_OF parent isn't in this trace. If several qualify
  // (orphans), enter from the earliest-starting one.
  const roots = spans.filter(
    (s) =>
      !s.references.some((r) => r.refType === 'CHILD_OF' && byId.has(r.spanID)),
  );
  if (roots.length === 0) {return out;}
  const root = roots.reduce((a, b) => (a.startTime <= b.startTime ? a : b));

  const spanEnd = (s: SpanLike) => s.startTime + Math.max(0, s.duration);

  const push = (spanId: string, start: number, end: number) => {
    if (!(end > start)) {return;} // drop zero / negative segments
    const list = out.get(spanId);
    if (list) {list.push({ start, end });}
    else {out.set(spanId, [{ start, end }]);}
  };

  // Walk one span, crediting its critical segments as the pointer moves back
  // from `endTime` to the span's start. Sibling handoffs iterate (a wide span
  // with many children won't grow the stack); depth recurses per tree level.
  const walk = (spanId: string, endTime: number, depth: number) => {
    if (depth > MAX_DEPTH) {return;}
    const span = byId.get(spanId);
    if (!span) {return;} // orphan / missing — skip, don't crash
    const start = span.startTime;
    const end = spanEnd(span);
    let pointer = Math.min(endTime, end);
    if (!(pointer > start)) {return;} // zero/negative duration

    const kids: SpanLike[] = [];
    for (const id of childrenByParent.get(spanId) ?? []) {
      const c = byId.get(id);
      if (c) {kids.push(c);}
    }

    while (pointer > start) {
      // The child that finished latest at-or-before the pointer, its range
      // clamped to the parent window.
      let best: { id: string; cs: number; ce: number } | null = null;
      for (const c of kids) {
        const cs = Math.max(c.startTime, start);
        const ce = Math.min(spanEnd(c), end);
        if (!(ce > cs)) {continue;} // no positive range inside the parent
        if (ce > pointer) {continue;} // hasn't finished by the pointer
        if (!best || ce > best.ce) {best = { id: c.spanID, cs, ce };}
      }
      if (!best) {
        push(spanId, start, pointer); // parent's own work down to its start
        return;
      }
      push(spanId, best.ce, pointer); // parent's own work after the child
      walk(best.id, best.ce, depth + 1); // the child is on the path
      pointer = best.cs; // resume just before the child started
    }
  };

  walk(root.spanID, spanEnd(root), 0);
  return out;
}
