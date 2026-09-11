import { act, renderHook, waitFor } from '@testing-library/react';
import { of, throwError } from 'rxjs';

import { TraceSummary } from '../types/trace';
import { fetchResource } from './resource';
import { traceLookupWindow, useFieldNames, useFieldValues, useTrace, useTraceSearch } from './traces';

jest.mock('./resource', () => ({
  fetchResource: jest.fn(),
}));

const mockFetchResource = fetchResource as jest.MockedFunction<typeof fetchResource>;

function summary(id: string, startSeconds: number): TraceSummary {
  return {
    traceID: id,
    rootServiceName: 'frontend',
    rootTraceName: 'GET /',
    startTimeUnixNano: startSeconds * 1e9,
    durationMs: 5,
  };
}

const START = 1_700_000_000;
const END = 1_700_003_600;

beforeEach(() => {
  mockFetchResource.mockReset();
});

describe('useTraceSearch', () => {
  it('does not fetch without a datasource uid', () => {
    renderHook(() => useTraceSearch(undefined, { start: START, end: END }));
    expect(mockFetchResource).not.toHaveBeenCalled();
  });

  it('does not fetch without a time range', () => {
    renderHook(() => useTraceSearch('uid', {}));
    expect(mockFetchResource).not.toHaveBeenCalled();
  });

  it('requests the first page with the range end as the cursor', async () => {
    mockFetchResource.mockReturnValue(of([summary('a', START + 10)]));

    const { result } = renderHook(() => useTraceSearch('uid', { start: START, end: END, limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'search', {
      q: '',
      start: START,
      end: END,
      limit: 2,
    });
    expect(result.current.traces.map((t) => t.traceID)).toEqual(['a']);
  });

  it('reports no more pages when a page is short', async () => {
    mockFetchResource.mockReturnValue(of([summary('a', START + 10)]));

    const { result } = renderHook(() => useTraceSearch('uid', { start: START, end: END, limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it('pages backwards from the oldest trace and dedupes by id', async () => {
    const firstPage = [summary('a', START + 100), summary('b', START + 50)];
    // 'b' repeats because the cursor is only second-granular.
    const secondPage = [summary('b', START + 50), summary('c', START + 20)];

    mockFetchResource.mockReturnValueOnce(of(firstPage)).mockReturnValueOnce(of(secondPage));

    const { result } = renderHook(() => useTraceSearch('uid', { start: START, end: END, limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.traces).toHaveLength(3));

    expect(mockFetchResource).toHaveBeenLastCalledWith('uid', 'search', {
      q: '',
      start: START,
      end: START + 50 - 1,
      limit: 2,
    });
    expect(result.current.traces.map((t) => t.traceID)).toEqual(['a', 'b', 'c']);
  });

  it('resets paging when the query changes', async () => {
    mockFetchResource.mockReturnValue(of([summary('a', START + 10)]));

    const { result, rerender } = renderHook(
      ({ query }) => useTraceSearch('uid', { query, start: START, end: END, limit: 2 }),
      { initialProps: { query: '' } }
    );

    await waitFor(() => expect(result.current.traces).toHaveLength(1));

    mockFetchResource.mockReturnValue(of([summary('z', START + 10)]));
    rerender({ query: 'error' });

    await waitFor(() => expect(result.current.traces.map((t) => t.traceID)).toEqual(['z']));
  });

  it('surfaces errors', async () => {
    mockFetchResource.mockReturnValue(throwError(() => new Error('boom')));

    const { result } = renderHook(() => useTraceSearch('uid', { start: START, end: END }));

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });
});

describe('traceLookupWindow', () => {
  it('brackets the trace start by an hour on each side', () => {
    // The upstream needs a range, and a trace can have spans either side of
    // the row's own start time.
    expect(traceLookupWindow('2023-11-14T22:13:20Z')).toEqual({
      start: '2023-11-14T21:13:20.000Z',
      end: '2023-11-14T23:13:20.000Z',
    });
  });

  it('falls back to the last day when the start is unknown', () => {
    jest.useFakeTimers().setSystemTime(new Date('2023-11-14T22:13:20Z'));
    expect(traceLookupWindow(undefined)).toEqual({
      start: '2023-11-13T22:13:20.000Z',
      end: '2023-11-14T22:13:20.000Z',
    });
    jest.useRealTimers();
  });

  it('falls back to the last day when the start does not parse', () => {
    jest.useFakeTimers().setSystemTime(new Date('2023-11-14T22:13:20Z'));
    expect(traceLookupWindow('nonsense')).toEqual({
      start: '2023-11-13T22:13:20.000Z',
      end: '2023-11-14T22:13:20.000Z',
    });
    jest.useRealTimers();
  });
});

describe('useTrace', () => {
  it('sends the time range the upstream requires', async () => {
    // Without a range VictoriaTraces reports every trace as out of retention.
    mockFetchResource.mockReturnValue(of({ traceID: 'abc', spans: [] }));

    const { result } = renderHook(() =>
      useTrace('uid', 'abc', { start: '2023-11-14T21:13:20.000Z', end: '2023-11-14T23:13:20.000Z' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'trace/abc', {
      start: '2023-11-14T21:13:20.000Z',
      end: '2023-11-14T23:13:20.000Z',
    });
  });

  it('does not fetch without a trace id', () => {
    renderHook(() => useTrace('uid', undefined, { start: 'a', end: 'b' }));
    expect(mockFetchResource).not.toHaveBeenCalled();
  });
});

describe('autocomplete scoping', () => {
  const RANGE = { start: '2023-11-14T21:00:00.000Z', end: '2023-11-14T22:00:00.000Z' };

  it('scopes field names to the range on screen', () => {
    // Suggestions from the whole retention window name keys that no longer
    // occur in the range the user is looking at.
    mockFetchResource.mockReturnValue(of([]));
    renderHook(() => useFieldNames('uid', 'checkout', RANGE));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'field_names', {
      service: 'checkout',
      start: RANGE.start,
      end: RANGE.end,
    });
  });

  it('scopes field values to the range on screen', () => {
    mockFetchResource.mockReturnValue(of([]));
    renderHook(() => useFieldValues('uid', 'span_attr:http.route', 'checkout', RANGE));

    expect(mockFetchResource).toHaveBeenCalledWith('uid', 'field_values', {
      field: 'span_attr:http.route',
      service: 'checkout',
      limit: 200,
      start: RANGE.start,
      end: RANGE.end,
    });
  });
});
