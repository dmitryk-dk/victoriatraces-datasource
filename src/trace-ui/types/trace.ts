// Jaeger-shaped trace model, as returned by the datasource `trace/<id>` resource.
// Ported from visum's ui/src/model/traces.

export type Field = StringField; // other types are not supported yet

export interface StringField {
  readonly key: string;
  readonly value: string;
  readonly type: 'string';
}

export interface Process {
  readonly serviceName: string;
  readonly tags: Field[];
}

export interface SpanLog {
  readonly timestamp: number;
  readonly fields: Field[];
}

export type SpanRefType = 'CHILD_OF' | 'FOLLOWS_FROM';

export interface SpanRef {
  readonly traceID: string;
  readonly spanID: string;
  readonly refType: SpanRefType;
}

export interface Span {
  readonly duration: number; // microseconds
  readonly logs?: SpanLog[];
  readonly operationName: string;
  readonly process?: Process;
  readonly processID: string;
  readonly references: SpanRef[];
  readonly spanID: string;
  readonly startTime: number; // unix timestamp in microseconds
  readonly tags: Field[];
  readonly traceID: string;
  readonly warnings?: string[];
}

export interface Trace {
  readonly traceID: string;
  readonly spans: Span[];
  readonly processes: Record<string, Process>;
  readonly warnings: string[];
}

export interface ServiceDependency {
  readonly parent: string;
  readonly child: string;
  readonly callCount: number;
}

// One row of the trace list, from the Tempo search endpoint. Deliberately much
// lighter than Trace: the list never needs spans.
export interface TraceSummary {
  readonly traceID: string;
  readonly rootServiceName: string;
  readonly rootTraceName: string;
  readonly startTimeUnixNano: number;
  readonly durationMs: number;
}
