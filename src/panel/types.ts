export interface TraceKeyValue {
  key: string;
  value: unknown;
  type?: string;
}

export interface TraceLog {
  timestamp: number; // ms
  fields: TraceKeyValue[];
}

export interface TraceSpanRef {
  traceID: string;
  spanID: string;
  refType: 'CHILD_OF' | 'FOLLOWS_FROM';
}

export interface TraceProcess {
  serviceName: string;
  tags: TraceKeyValue[];
}

export interface TraceSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  processID: string;
  startTime: number; // ms
  duration: number;  // ms
  references: TraceSpanRef[];
  tags: TraceKeyValue[];
  logs: TraceLog[];
  warnings?: string[];
}

export interface Trace {
  traceID: string;
  spans: TraceSpan[];
  processes: Record<string, TraceProcess>;
}

export interface TraceSearchRow {
  traceID: string;
  traceName: string;
  rootServiceName: string;
  rootTraceName: string;
  startTime: number; // ms
  traceDuration: number; // ms
  spanCount: number;
  errorCount?: number;
}

export interface FlatSpanNode {
  span: TraceSpan;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}
