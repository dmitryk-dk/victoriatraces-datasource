import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { TraceListRow } from '../api/traceList';
import { TraceList } from './TraceList';
import { ALL_COLUMNS, customColumns } from './traceColumns';

function row(overrides: Partial<TraceListRow> = {}): TraceListRow {
  return {
    traceID: 'abc123',
    rootService: 'checkout',
    rootOperation: 'POST /order',
    services: ['checkout', 'payments'],
    startTime: '2026-08-18T10:00:00.000Z',
    durationMicros: 25_000,
    spans: 3,
    errors: 1,
    partial: false,
    ...overrides,
  };
}

describe('TraceList', () => {
  // The trace id renders twice per row: the truncated cell and the copy
  // overlay revealed on hover, so these assertions match all occurrences.
  it('renders a row per trace', () => {
    render(<TraceList rows={[row(), row({ traceID: 'def456', rootOperation: 'GET /' })]} />);
    expect(screen.getAllByText('abc123').length).toBeGreaterThan(0);
    expect(screen.getAllByText('def456').length).toBeGreaterThan(0);
    expect(screen.getByText('POST /order')).toBeInTheDocument();
    expect(screen.getByText('GET /')).toBeInTheDocument();
  });

  it('filters on trace id, operation and service', () => {
    const rows = [row(), row({ traceID: 'def456', rootOperation: 'GET /', services: ['frontend'] })];

    const { rerender } = render(<TraceList rows={rows} search="frontend" />);
    expect(screen.queryAllByText('abc123')).toHaveLength(0);
    expect(screen.getAllByText('def456').length).toBeGreaterThan(0);

    rerender(<TraceList rows={rows} search="POST" />);
    expect(screen.getAllByText('abc123').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('def456')).toHaveLength(0);
  });

  it('explains an empty search result', () => {
    render(<TraceList rows={[row()]} search="nothing-matches" />);
    expect(screen.getByText('No traces match your search.')).toBeInTheDocument();
  });

  describe('states', () => {
    it('says the range is empty when there is nothing to filter', () => {
      // Blaming the search box for a range that holds no traces sends the user
      // looking for a filter they never set.
      render(<TraceList rows={[]} />);
      expect(screen.getByText('No traces in this time range.')).toBeInTheDocument();
    });

    it('still blames the search when a search is active', () => {
      render(<TraceList rows={[]} search="checkout" />);
      expect(screen.getByText('No traces match your search.')).toBeInTheDocument();
    });

    it('reports that traces are loading', () => {
      render(<TraceList rows={[]} loading />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('No traces in this time range.')).not.toBeInTheDocument();
    });

    it('keeps the rows on screen while the next refresh runs', () => {
      // Blanking the table on every refresh makes a live panel unreadable.
      render(<TraceList rows={[row()]} loading />);
      expect(screen.getAllByText('abc123').length).toBeGreaterThan(0);
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    });

    it('reports a failure and what went wrong', () => {
      render(<TraceList rows={[]} error={new Error('upstream refused')} />);
      expect(screen.getByText(/Failed to load traces/)).toBeInTheDocument();
      expect(screen.getByText(/upstream refused/)).toBeInTheDocument();
    });

    it('prefers the error over an empty range', () => {
      render(<TraceList rows={[]} error={new Error('boom')} />);
      expect(screen.queryByText('No traces in this time range.')).not.toBeInTheDocument();
    });
  });

  it('renders only the columns it is given', () => {
    render(<TraceList rows={[row()]} columns={ALL_COLUMNS.filter((c) => c.key !== 'spans')} />);
    expect(screen.queryByText('Spans')).not.toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('offers a resize handle between columns but not after the last', () => {
    render(<TraceList rows={[row()]} />);
    const handles = screen.getAllByLabelText(/^Resize /);
    expect(handles).toHaveLength(ALL_COLUMNS.length - 1);
    expect(screen.queryByLabelText('Resize Errors column')).not.toBeInTheDocument();
  });

  it('opens the preview when a row is clicked', () => {
    const onPreviewRow = jest.fn();
    render(<TraceList rows={[row()]} onPreviewRow={onPreviewRow} />);

    fireEvent.click(screen.getAllByText('POST /order')[0]);
    expect(onPreviewRow).toHaveBeenCalledWith(expect.objectContaining({ traceID: 'abc123' }));
  });

  it('opens the full trace without also opening the preview', () => {
    const onPreviewRow = jest.fn();
    const onOpenTrace = jest.fn();
    render(<TraceList rows={[row()]} onPreviewRow={onPreviewRow} onOpenTrace={onOpenTrace} />);

    fireEvent.click(screen.getByLabelText('Open full trace view'));
    expect(onOpenTrace).toHaveBeenCalled();
    expect(onPreviewRow).not.toHaveBeenCalled();
  });

  it('marks a partial trace', () => {
    render(<TraceList rows={[row({ partial: true, rootOperation: '' })]} />);
    expect(screen.getByText('(partial)')).toBeInTheDocument();
  });

  it('copies the trace id without opening the preview', () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const onPreviewRow = jest.fn();
    render(<TraceList rows={[row()]} onPreviewRow={onPreviewRow} />);

    fireEvent.click(screen.getByLabelText('Copy trace ID'));
    expect(writeText).toHaveBeenCalledWith('abc123');
    expect(onPreviewRow).not.toHaveBeenCalled();
  });

  describe('custom attribute columns', () => {
    const columns = [...ALL_COLUMNS, ...customColumns(['span_attr:http.status_code'])];

    it('labels the column from the field name', () => {
      render(<TraceList rows={[row()]} columns={columns} />);
      expect(screen.getByText('HTTP status')).toBeInTheDocument();
    });

    it('renders the value for that field', () => {
      const rows = [row({ attrs: { 'span_attr:http.status_code': '500' } })];
      render(<TraceList rows={rows} columns={columns} />);
      expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('leaves the cell blank when the trace has no such attribute', () => {
      render(<TraceList rows={[row({ attrs: {} })]} columns={columns} />);
      // The column is present even though this trace carries no value.
      expect(screen.getByText('HTTP status')).toBeInTheDocument();
      expect(screen.queryByText('500')).not.toBeInTheDocument();
    });
  });
});
