import React from 'react';
import { render } from '@testing-library/react';

import { TraceSpanTree } from './TraceSpanTree';
import type { Trace, TraceSpan } from '../types';

// The virtualizer's own scrolling needs real layout, which jsdom has none of.
// Faking it keeps the assertion on what this component decides: which row to
// bring into view. Every row renders, so the rest of the tree still works.
const scrollToIndex = jest.fn();

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 28, size: 28 })),
    scrollToIndex,
  }),
}));

const TRACE_ID = 't';

function span(spanID: string, parent?: string): TraceSpan {
  return {
    traceID: TRACE_ID,
    spanID,
    operationName: spanID,
    processID: 'p',
    startTime: 0,
    duration: 10,
    tags: [],
    logs: [],
    references: parent ? [{ refType: 'CHILD_OF', spanID: parent, traceID: TRACE_ID }] : [],
  };
}

function trace(spans: TraceSpan[]): Trace {
  return { traceID: TRACE_ID, spans, processes: { p: { serviceName: 'frontend', tags: [] } } };
}

const spans = [span('root'), span('a', 'root'), span('b', 'root'), span('c', 'root')];

beforeEach(() => {
  scrollToIndex.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('TraceSpanTree scroll-to-selection', () => {
  it('scrolls to the row of the selected span', () => {
    // A span selected by deep link or from the table view can sit far below
    // the fold; leaving the reader to find it defeats the point.
    render(<TraceSpanTree trace={trace(spans)} selectedSpanId="c" />);
    jest.advanceTimersByTime(50);

    expect(scrollToIndex).toHaveBeenCalledWith(3, { align: 'center' });
  });

  it('does not scroll when nothing is selected', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    jest.advanceTimersByTime(50);

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not scroll to a span the filter has hidden', () => {
    render(<TraceSpanTree trace={trace(spans)} selectedSpanId="missing-span" />);
    jest.advanceTimersByTime(50);

    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
