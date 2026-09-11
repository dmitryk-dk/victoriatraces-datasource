import { buildFlatTree } from './TraceSpanTree';
import type { TraceSpan } from '../types';

const TRACE = 't';

function span(spanID: string, startTime: number, parent?: string): TraceSpan {
  return {
    traceID: TRACE,
    spanID,
    operationName: spanID,
    processID: 'p',
    startTime,
    duration: 1,
    tags: [],
    logs: [],
    references: parent ? [{ refType: 'CHILD_OF', spanID: parent, traceID: TRACE }] : [],
  };
}

const expandAll = (spans: TraceSpan[]) => new Set(spans.map((s) => s.spanID));

describe('buildFlatTree', () => {
  it('nests children under their parent with increasing depth', () => {
    const spans = [span('root', 0), span('child', 1, 'root'), span('grandchild', 2, 'child')];
    const flat = buildFlatTree(spans, expandAll(spans), TRACE);
    expect(flat.map((n) => [n.span.spanID, n.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
    ]);
  });

  it('orders siblings chronologically, not by array order', () => {
    const spans = [span('c', 30, 'root'), span('a', 10, 'root'), span('b', 20, 'root'), span('root', 0)];
    const flat = buildFlatTree(spans, expandAll(spans), TRACE);
    expect(flat.map((n) => n.span.spanID)).toEqual(['root', 'a', 'b', 'c']);
  });

  it('renders spans whose parent is missing from the trace', () => {
    // Partial trace: the parent was never ingested or is out of range. These
    // spans must still appear rather than vanishing from the waterfall.
    const spans = [span('orphan', 5, 'not-in-trace'), span('root', 0)];
    const flat = buildFlatTree(spans, expandAll(spans), TRACE);
    expect(flat.map((n) => n.span.spanID).sort()).toEqual(['orphan', 'root']);
    expect(flat.every((n) => n.depth === 0)).toBe(true);
  });

  it('hides children of a collapsed span', () => {
    const spans = [span('root', 0), span('child', 1, 'root')];
    const flat = buildFlatTree(spans, new Set(), TRACE);
    expect(flat.map((n) => n.span.spanID)).toEqual(['root']);
    expect(flat[0].hasChildren).toBe(true);
    expect(flat[0].isExpanded).toBe(false);
  });

  it('marks leaves as having no children', () => {
    const spans = [span('root', 0), span('leaf', 1, 'root')];
    const flat = buildFlatTree(spans, expandAll(spans), TRACE);
    expect(flat.find((n) => n.span.spanID === 'leaf')?.hasChildren).toBe(false);
  });

  it('shows the earliest root first when a trace has several', () => {
    const spans = [span('late', 50), span('early', 10)];
    const flat = buildFlatTree(spans, expandAll(spans), TRACE);
    expect(flat.map((n) => n.span.spanID)).toEqual(['early', 'late']);
  });
});
