import type { SpanLike } from './spanLike';

/**
 * Buckets each span's CHILD_OF children by parent id, ordering siblings by
 * start time.
 *
 * The backend returns spans grouped by service rather than chronologically, so
 * without this sort an async parent's children render grouped instead of
 * interleaved. Equal start times tie-break on span id so the order is stable
 * across refetches.
 */
export function buildChildrenByParent<T extends SpanLike>(spans: readonly T[], traceID: string): Map<string, string[]> {
  const startBySpanId = new Map(spans.map((s) => [s.spanID, s.startTime]));
  const childrenByParent = new Map<string, string[]>();

  for (const span of spans) {
    for (const ref of span.references) {
      // Both sides must belong to this trace: a CHILD_OF ref can point at a
      // parent in another trace, which is not part of this tree.
      if (ref.refType === 'CHILD_OF' && ref.traceID === traceID && ref.traceID === span.traceID) {
        const bucket = childrenByParent.get(ref.spanID);
        if (bucket) {
          bucket.push(span.spanID);
        } else {
          childrenByParent.set(ref.spanID, [span.spanID]);
        }
      }
    }
  }

  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => {
      const d = (startBySpanId.get(a) ?? 0) - (startBySpanId.get(b) ?? 0);
      return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
    });
  }

  return childrenByParent;
}

/** Root spans: those whose CHILD_OF parent is not part of this trace. */
export function findRootSpans<T extends SpanLike>(spans: readonly T[]): T[] {
  const byId = new Set(spans.map((s) => s.spanID));
  return spans.filter((s) => !s.references.some((r) => r.refType === 'CHILD_OF' && byId.has(r.spanID)));
}

export function isErrorSpan(tags: ReadonlyArray<{ key: string; value: unknown }>): boolean {
  return tags.some(
    (t) =>
      (t.key === 'error' && t.value === 'true') || (t.key === 'otel.status_code' && t.value === '2')
  );
}
