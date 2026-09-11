/**
 * A span the user picked, remembered together with the trace it belongs to.
 * `spanID` is undefined once the user closes the details panel: the choice was
 * made in this trace and should survive a re-render, unlike having chosen
 * nothing at all.
 */
export interface SpanSelection {
  traceID: string;
  spanID?: string;
}

/**
 * Which span the trace view should show as selected.
 *
 * A selection only speaks for the trace it was made in. Opening another trace
 * falls back to the span the query carried in — the one that matched the
 * search — rather than keeping a choice from a trace no longer on screen.
 */
export function resolveSelectedSpan(
  selection: SpanSelection | null,
  traceID: string | undefined,
  targetSpanID: string | undefined
): string | undefined {
  if (!traceID) {
    return undefined;
  }
  if (selection?.traceID === traceID) {
    return selection.spanID;
  }
  return targetSpanID;
}
