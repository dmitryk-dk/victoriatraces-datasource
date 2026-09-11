/**
 * The minimal span shape the trace algorithms need.
 *
 * Both the app (Jaeger-shaped, microseconds) and the panels (DataFrame-derived,
 * milliseconds) satisfy this. The algorithms only ever compare and subtract
 * times, never interpret their unit, so one implementation serves both — as
 * long as a single call site does not mix units.
 */
export interface SpanLike {
  readonly spanID: string;
  readonly traceID: string;
  readonly startTime: number;
  readonly duration: number;
  readonly references: ReadonlyArray<{
    readonly refType: string;
    readonly spanID: string;
    readonly traceID: string;
  }>;
}
