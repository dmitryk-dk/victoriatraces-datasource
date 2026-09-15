import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Trace, TraceSpan } from '../types';
import { SpanTable } from './SpanTable';

function span(spanID: string, startTime: number, duration: number, processID: string, error = false): TraceSpan {
  return {
    traceID: 't',
    spanID,
    operationName: `op-${spanID}`,
    processID,
    startTime,
    duration,
    references: [],
    logs: [],
    tags: error ? [{ key: 'error', value: 'true' }] : [],
  };
}

const trace: Trace = {
  traceID: 't',
  processes: {
    p1: { serviceName: 'frontend', tags: [] },
    p2: { serviceName: 'ledger', tags: [] },
  },
  spans: [
    span('slow', 100, 500, 'p2'),
    span('fast', 0, 10, 'p1', true),
    span('mid', 50, 100, 'p1'),
  ],
};

function rowOrder(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map((row) => row.textContent ?? '');
}

describe('SpanTable', () => {
  it('lists every span with its service', () => {
    render(<SpanTable trace={trace} />);
    expect(screen.getByText('op-slow')).toBeInTheDocument();
    expect(screen.getAllByText('frontend')).toHaveLength(2);
    expect(screen.getByText('ledger')).toBeInTheDocument();
  });

  it('sorts by start time by default', () => {
    render(<SpanTable trace={trace} />);
    expect(rowOrder().map((r) => r.match(/op-\w+/)?.[0])).toEqual(['op-fast', 'op-mid', 'op-slow']);
  });

  it('sorts duration longest-first on the first click', () => {
    // Slowest-first is the useful default for a duration column.
    render(<SpanTable trace={trace} />);
    fireEvent.click(screen.getByText('Duration'));
    expect(rowOrder().map((r) => r.match(/op-\w+/)?.[0])).toEqual(['op-slow', 'op-mid', 'op-fast']);
  });

  it('reverses when the same column is clicked again', () => {
    render(<SpanTable trace={trace} />);
    fireEvent.click(screen.getByText('Duration'));
    fireEvent.click(screen.getByText('Duration'));
    expect(rowOrder().map((r) => r.match(/op-\w+/)?.[0])).toEqual(['op-fast', 'op-mid', 'op-slow']);
  });

  it('shows start times relative to the trace start', () => {
    render(<SpanTable trace={trace} />);
    // The earliest span sits at offset zero; later ones are positive offsets.
    expect(screen.getByText('+0µs')).toBeInTheDocument();
    expect(screen.getByText('+50.00ms')).toBeInTheDocument();
  });

  it('marks errored spans', () => {
    render(<SpanTable trace={trace} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(2);
  });

  it('selects a span when its row is clicked', () => {
    const onSelectSpan = jest.fn();
    render(<SpanTable trace={trace} onSelectSpan={onSelectSpan} />);
    fireEvent.click(screen.getByText('op-mid'));
    expect(onSelectSpan).toHaveBeenCalledWith('mid');
  });
});
