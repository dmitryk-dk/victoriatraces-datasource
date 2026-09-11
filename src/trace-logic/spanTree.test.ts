import type { SpanLike as Span } from './spanLike';
import { buildChildrenByParent, findRootSpans, isErrorSpan } from './spanTree';

const TRACE = 't';

function span(spanID: string, startTime: number, parent?: string): Span {
  return {
    spanID,
    traceID: TRACE,
    startTime,
    duration: 1,
    references: parent ? [{ refType: 'CHILD_OF', spanID: parent, traceID: TRACE }] : [],
  };
}

describe('buildChildrenByParent', () => {
  it('orders siblings by startTime regardless of array order', () => {
    const spans = [span('c', 30, 'root'), span('a', 10, 'root'), span('b', 20, 'root'), span('root', 0)];
    expect(buildChildrenByParent(spans, TRACE).get('root')).toEqual(['a', 'b', 'c']);
  });

  it('interleaves async siblings the backend returned grouped', () => {
    // Backend groups the HTTP calls and then the three long-running sleeps,
    // but their start times interleave; the tree must show real chronology.
    const spans = [
      span('post1', 1785248083588846, 'script'),
      span('delete1', 1785248083887397, 'script'),
      span('get1', 1785248083687158, 'script'),
      span('sleep1', 1785248083593324, 'script'),
      span('sleep2', 1785248083692579, 'script'),
      span('sleep3', 1785248083793265, 'script'),
      span('put1', 1785248083788336, 'script'),
      span('script', 1785248083588697),
    ];
    expect(buildChildrenByParent(spans, TRACE).get('script')).toEqual([
      'post1',
      'sleep1',
      'get1',
      'sleep2',
      'put1',
      'sleep3',
      'delete1',
    ]);
  });

  it('tie-breaks equal startTimes by spanID for a stable order', () => {
    const spans = [span('z', 5, 'root'), span('a', 5, 'root'), span('root', 0)];
    expect(buildChildrenByParent(spans, TRACE).get('root')).toEqual(['a', 'z']);
  });

  it('ignores refs from other traces', () => {
    const foreign: Span = {
      ...span('x', 10, 'root'),
      references: [{ refType: 'CHILD_OF', spanID: 'root', traceID: 'other' }],
    };
    expect(buildChildrenByParent([foreign, span('root', 0)], TRACE).get('root')).toBeUndefined();
  });
});

describe('findRootSpans', () => {
  it('returns spans whose parent is absent from the trace', () => {
    const spans = [span('root', 0), span('child', 1, 'root')];
    expect(findRootSpans(spans).map((s) => s.spanID)).toEqual(['root']);
  });

  it('treats a span referencing a missing parent as a root', () => {
    // A partial trace: the parent was not ingested or is out of range.
    const orphan = span('orphan', 5, 'gone');
    expect(findRootSpans([orphan]).map((s) => s.spanID)).toEqual(['orphan']);
  });
});

describe('isErrorSpan', () => {
  it('detects both error conventions', () => {
    expect(isErrorSpan([{ key: 'error', value: 'true' }])).toBe(true);
    expect(isErrorSpan([{ key: 'otel.status_code', value: '2' }])).toBe(true);
  });

  it('ignores non-error tags and healthy values', () => {
    expect(isErrorSpan([])).toBe(false);
    expect(isErrorSpan([{ key: 'error', value: 'false' }])).toBe(false);
    expect(isErrorSpan([{ key: 'otel.status_code', value: '1' }])).toBe(false);
    expect(isErrorSpan([{ key: 'http.status_code', value: '500' }])).toBe(false);
  });
});
