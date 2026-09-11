import { act, renderHook, waitFor } from '@testing-library/react';
import { of, throwError } from 'rxjs';

import { Trace } from '../types/trace';
import { fetchResource } from './resource';
import { TraceListRow, toSpanSummaries, useTraceList, useTraceSample } from './traceList';

jest.mock('./resource', () => ({
  fetchResource: jest.fn(),
}));

const mockFetchResource = fetchResource as jest.MockedFunction<typeof fetchResource>;

const START = '2026-08-17T10:00:00.000Z';
const END = '2026-08-17T11:00:00.000Z';

function row(traceID: string, startTime: string): TraceListRow {
  return {
    traceID,
    rootService: 'frontend',
    rootOperation: 'GET /',
    services: ['frontend'],
    startTime,
    durationMicros: 1000,
    spans: 2,
    errors: 0,
    partial: false,
  };
}

beforeEach(() => {
  mockFetchResource.mockReset();
});

describe('useTraceList continuing an existing page', () => {
  const OLDEST = '2026-08-17T10:30:00.000Z';

  it('waits for loadMore when it is not the one loading the first page', () => {
    // The panel's own query already produced page one; fetching it again here
    // would double every row on screen.
    renderHook(() =>
      useTraceList('uid', { start: START, end: END, after: OLDEST, autoLoad: false })
    );
    expect(mockFetchResource).not.toHaveBeenCalled();
  });

  it('reports more pages before it has fetched anything', () => {
    const { result } = renderHook(() =>
      useTraceList('uid', {
        start: START,
        end: END,
        after: OLDEST,
        autoLoad: false,
        initiallyHasMore: true,
      })
    );
    expect(result.current.hasMore).toBe(true);
  });

  it('pages backwards from the row the caller already has', async () => {
    mockFetchResource.mockReturnValue(of([row('c', '2026-08-17T10:20:00.000Z')]));

    const { result } = renderHook(() =>
      useTraceList('uid', {
        start: START,
        end: END,
        after: OLDEST,
        autoLoad: false,
        initiallyHasMore: true,
        limit: 2,
      })
    );

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'trace_list', {
      where: '',
      postFilter: '',
      matchCond: '',
      start: START,
      end: OLDEST,
      limit: 2,
    });
  });

  it('starts over when the query it continues changes', async () => {
    mockFetchResource.mockReturnValue(of([row('c', '2026-08-17T10:20:00.000Z')]));

    const { result, rerender } = renderHook(
      ({ after }) =>
        useTraceList('uid', { start: START, end: END, after, autoLoad: false, initiallyHasMore: true }),
      { initialProps: { after: OLDEST } }
    );

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    rerender({ after: '2026-08-17T10:45:00.000Z' });
    expect(result.current.rows).toHaveLength(0);
  });
});

describe('useTraceList', () => {
  it('does not fetch without a datasource or time range', () => {
    renderHook(() => useTraceList(undefined, { start: START, end: END }));
    renderHook(() => useTraceList('uid', {}));
    expect(mockFetchResource).not.toHaveBeenCalled();
  });

  it('requests the first page with the range end as the cursor', async () => {
    mockFetchResource.mockReturnValue(of([row('a', '2026-08-17T10:30:00.000Z')]));

    const { result } = renderHook(() => useTraceList('uid', { start: START, end: END, limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'trace_list', {
      where: '',
      postFilter: '',
      matchCond: '',
      start: START,
      end: END,
      limit: 2,
    });
    expect(result.current.rows.map((r) => r.traceID)).toEqual(['a']);
    // A short page means the range is exhausted.
    expect(result.current.hasMore).toBe(false);
  });

  it('pages from the last row start time and dedupes by trace id', async () => {
    const firstPage = [row('a', '2026-08-17T10:50:00.000Z'), row('b', '2026-08-17T10:40:00.000Z')];
    // 'b' repeats: rows sharing a timestamp can straddle the cursor boundary.
    const secondPage = [row('b', '2026-08-17T10:40:00.000Z'), row('c', '2026-08-17T10:20:00.000Z')];

    mockFetchResource.mockReturnValueOnce(of(firstPage)).mockReturnValueOnce(of(secondPage));

    const { result } = renderHook(() => useTraceList('uid', { start: START, end: END, limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    expect(mockFetchResource).toHaveBeenLastCalledWith('uid', 'trace_list', {
      where: '',
      postFilter: '',
      matchCond: '',
      start: START,
      end: '2026-08-17T10:40:00.000Z',
      limit: 2,
    });
    expect(result.current.rows.map((r) => r.traceID)).toEqual(['a', 'b', 'c']);
  });

  it('resets paging when the filter changes', async () => {
    mockFetchResource.mockReturnValue(of([row('a', '2026-08-17T10:30:00.000Z')]));

    const { result, rerender } = renderHook(
      ({ where }) => useTraceList('uid', { where, start: START, end: END, limit: 2 }),
      { initialProps: { where: '' } }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    mockFetchResource.mockReturnValue(of([row('z', '2026-08-17T10:30:00.000Z')]));
    rerender({ where: 'status_code:2' });

    await waitFor(() => expect(result.current.rows.map((r) => r.traceID)).toEqual(['z']));
  });

  it('surfaces errors', async () => {
    mockFetchResource.mockReturnValue(throwError(() => new Error('boom')));

    const { result } = renderHook(() => useTraceList('uid', { start: START, end: END }));

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });
});

describe('toSpanSummaries', () => {
  const trace: Trace = {
    traceID: 't1',
    processes: { p1: { serviceName: 'frontend', tags: [] }, p2: { serviceName: 'payments', tags: [] } },
    warnings: [],
    spans: [
      {
        traceID: 't1',
        spanID: 'root',
        operationName: 'GET /',
        processID: 'p1',
        startTime: 1000,
        duration: 500,
        tags: [],
        references: [],
      },
      {
        traceID: 't1',
        spanID: 'child',
        operationName: 'Charge',
        processID: 'p2',
        startTime: 1100,
        duration: 200,
        tags: [{ key: 'error', value: 'true', type: 'string' }],
        references: [{ refType: 'CHILD_OF', spanID: 'root', traceID: 't1' }],
      },
    ],
  };

  it('resolves the service via the trace process map', () => {
    const summaries = toSpanSummaries(trace);
    expect(summaries.map((s) => s.service)).toEqual(['frontend', 'payments']);
  });

  it('links a child to its CHILD_OF parent', () => {
    const summaries = toSpanSummaries(trace);
    expect(summaries[0].parentSpanId).toBeUndefined();
    expect(summaries[1].parentSpanId).toBe('root');
  });

  it('flags error spans from their tags', () => {
    const summaries = toSpanSummaries(trace);
    expect(summaries[0].error).toBe(false);
    expect(summaries[1].error).toBe(true);
  });

  it('handles an absent trace', () => {
    expect(toSpanSummaries(undefined)).toEqual([]);
  });
});

describe('useTraceSample', () => {
  it('asks for a spread sample, not a page of the list', () => {
    // The list is newest-first; a limit against it returns the last few
    // seconds on a busy source and stacks every point on one edge.
    mockFetchResource.mockReturnValue(of({ rows: [], total: 0 }));
    renderHook(() => useTraceSample('uid', 'span_id:*', START, END, 1000));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'trace_sample', {
      where: 'span_id:*',
      start: START,
      end: END,
      limit: 1000,
    });
  });

  it('reports the rows and the size of the set they came from', async () => {
    mockFetchResource.mockReturnValue(
      of({ rows: [row('a', START)], total: 4210 })
    );

    const { result } = renderHook(() => useTraceSample('uid', '', START, END, 1000));

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.total).toBe(4210);
  });

  it('does not fetch without a range', () => {
    renderHook(() => useTraceSample('uid', '', undefined, undefined, 1000));
    expect(mockFetchResource).not.toHaveBeenCalled();
  });
});

