import type { Trace } from '../types';

interface ServiceEdge {
  source: string;
  target: string;
  callCount: number;
}

interface ServiceGraph {
  nodeIds: string[];
  edges: ServiceEdge[];
}

/**
 * Extracts a service-level dependency graph from a single trace.
 * Each unique service becomes a node; each parent→child span relationship
 * between different services becomes an edge with a call count.
 */
export function traceToServiceGraph(trace: Trace): ServiceGraph {
  const { spans, processes } = trace;

  // Build a map of spanID → serviceName
  const spanService = new Map<string, string>();
  for (const span of spans) {
    const serviceName = processes[span.processID]?.serviceName ?? span.processID;
    spanService.set(span.spanID, serviceName);
  }

  // Collect unique services
  const serviceSet = new Set<string>(spanService.values());

  // Count edges between services (parent service → child service)
  const edgeMap = new Map<string, number>();
  for (const span of spans) {
    const childService = spanService.get(span.spanID) ?? '';
    const parentRef = span.references.find((r) => r.refType === 'CHILD_OF');
    if (!parentRef) {
      continue;
    }
    const parentService = spanService.get(parentRef.spanID);
    if (!parentService || parentService === childService) {
      continue;
    }
    const key = `${parentService}\0${childService}`;
    edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
  }

  const edges: ServiceEdge[] = [];
  for (const [key, count] of edgeMap) {
    const [source, target] = key.split('\0');
    edges.push({ source, target, callCount: count });
  }

  return {
    nodeIds: Array.from(serviceSet),
    edges,
  };
}

