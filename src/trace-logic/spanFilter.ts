import { isErrorSpan } from './spanTree';

/** The parts of a span this filter reads. */
export interface SpanFilterable {
  spanID: string;
  operationName: string;
  processID: string;
  tags: ReadonlyArray<{ key: string; value: unknown }>;
  references: ReadonlyArray<{ refType: string; spanID: string; traceID?: string }>;
}

/** What the reader is narrowing the waterfall to. */
export interface SpanFilter {
  /** Substring match against the span's operation name. */
  readonly text: string;
  /** Services to keep; empty means every service. */
  readonly services: readonly string[];
  readonly errorsOnly: boolean;
}

export const EMPTY_SPAN_FILTER: SpanFilter = {
  text: '',
  services: [],
  errorsOnly: false,
};

export function isSpanFilterActive(filter: SpanFilter): boolean {
  return filter.text.trim() !== '' || filter.services.length > 0 || filter.errorsOnly;
}

export interface FilteredSpans {
  /** Spans the filter actually selected. */
  readonly matched: ReadonlySet<string>;
  /**
   * Spans to render: the matches plus every ancestor of a match. Ancestors are
   * kept so a match holds its place in the tree — a span is far easier to read
   * against the parents that led to it than on its own.
   */
  readonly visible: ReadonlySet<string>;
}

export function spanService(
  span: SpanFilterable,
  processes: Record<string, { serviceName: string }>
): string {
  return processes[span.processID]?.serviceName ?? span.processID;
}

/** The services present in a trace, in first-seen order. */
export function traceServices(
  spans: readonly SpanFilterable[],
  processes: Record<string, { serviceName: string }>
): string[] {
  const seen = new Set<string>();
  for (const span of spans) {
    seen.add(spanService(span, processes));
  }
  return [...seen];
}

function parentIdOf(span: SpanFilterable): string | undefined {
  return span.references.find((r) => r.refType === 'CHILD_OF')?.spanID;
}

/**
 * Applies a filter to a trace's spans. All three criteria must hold for a span
 * to match; an inactive criterion holds for everything.
 */
export function filterSpans(
  spans: readonly SpanFilterable[],
  processes: Record<string, { serviceName: string }>,
  filter: SpanFilter
): FilteredSpans {
  const text = filter.text.trim().toLowerCase();
  const services = new Set(filter.services);

  const matched = new Set<string>();
  for (const span of spans) {
    if (text && !span.operationName.toLowerCase().includes(text)) {
      continue;
    }
    if (services.size > 0 && !services.has(spanService(span, processes))) {
      continue;
    }
    if (filter.errorsOnly && !isErrorSpan(span.tags)) {
      continue;
    }
    matched.add(span.spanID);
  }

  // Walk each match up to its root, adding the chain. Spans are indexed first
  // so this stays linear-ish rather than rescanning the trace per ancestor.
  const byId = new Map(spans.map((s) => [s.spanID, s]));
  const visible = new Set(matched);
  for (const spanId of matched) {
    const span = byId.get(spanId);
    let parentId = span ? parentIdOf(span) : undefined;
    // `visible` doubles as the seen-set: a chain reaching an ancestor already
    // added is done, which also stops a cyclic parent reference looping.
    while (parentId && !visible.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) {
        // A partial trace: the parent was never ingested. Nothing to reveal.
        break;
      }
      visible.add(parentId);
      parentId = parentIdOf(parent);
    }
  }

  return { matched, visible };
}
