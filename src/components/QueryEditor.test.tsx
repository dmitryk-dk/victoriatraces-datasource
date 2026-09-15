import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryEditor } from './QueryEditor';
import { defaultQuery, VictoriaTracesQuery } from '../types';
import { DataSource } from '../datasource';

// Grafana's Monaco cannot load under jsdom (the package is ESM-only). The
// editor itself is exercised in the browser; these tests cover the surrounding
// query controls.
jest.mock('./monaco-query-field/MonacoQueryFieldWrapper', () => ({
  MonacoQueryFieldWrapper: () => null,
}));
jest.mock('../trace-ui/components/TraceFilterBar', () => ({
  // The bar itself is out of scope here, but the entity toggle is handed to it
  // to render, so the stub has to pass that through or the editor looks empty.
  TraceFilterBar: ({ leading }: { leading?: React.ReactNode }) => <>{leading}</>,
}));

const mockDatasource = {
  getServices: jest.fn().mockResolvedValue(['frontend', 'backend']),
  getOperations: jest.fn().mockResolvedValue(['GET /api', 'POST /login']),
  getFieldNames: jest.fn().mockResolvedValue(['http.status_code', 'error']),
  getFieldValues: jest.fn().mockResolvedValue(['200', '500']),
} as unknown as DataSource;

function makeProps(overrides: Partial<VictoriaTracesQuery> = {}) {
  const query = { refId: 'A', ...defaultQuery, ...overrides } as VictoriaTracesQuery;
  return {
    datasource: mockDatasource,
    query,
    onChange: jest.fn(),
    onRunQuery: jest.fn(),
  };
}

describe('QueryEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens on the trace list, which is the default query type', async () => {
    render(<QueryEditor {...makeProps()} />);
    await waitFor(() => {
      // "Traces" labels both the query type and the traces/spans toggle.
      expect(screen.getAllByText('Traces').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Spans')).toBeInTheDocument();
    // The filter bar owns the controls in this mode, not the search fields.
    expect(screen.queryByText('Service')).not.toBeInTheDocument();
  });

  it('switches the query type when the spans toggle is used', async () => {
    const props = makeProps();
    render(<QueryEditor {...props} />);

    fireEvent.click(screen.getByText('Spans'));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'spanList', entity: 'spans' })
    );
  });

  it('renders the search fields in search mode', async () => {
    render(<QueryEditor {...makeProps({ queryType: 'search' })} />);
    expect(screen.getByText('Search')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Service')).toBeInTheDocument();
    });
  });

  it('renders trace ID input when queryType is traceId', async () => {
    render(<QueryEditor {...makeProps({ queryType: 'traceId' })} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/3fa414edcef6ad90/)).toBeInTheDocument();
    });
  });

  it('does not render search fields in traceId mode', async () => {
    render(<QueryEditor {...makeProps({ queryType: 'traceId' })} />);
    await waitFor(() => {
      expect(screen.queryByText('Service')).not.toBeInTheDocument();
    });
  });

  it('calls getServices on mount', async () => {
    render(<QueryEditor {...makeProps()} />);
    await waitFor(() => {
      expect(mockDatasource.getServices).toHaveBeenCalledTimes(1);
    });
  });

  it('updates traceId field and calls onRunQuery on blur', async () => {
    const props = makeProps({ queryType: 'traceId' });
    render(<QueryEditor {...props} />);

    const input = await screen.findByPlaceholderText(/3fa414edcef6ad90/);
    fireEvent.change(input, { target: { value: 'abc123' } });
    fireEvent.blur(input);

    expect(props.onChange).toHaveBeenCalled();
    const updated = props.onChange.mock.calls[0][0] as VictoriaTracesQuery;
    expect(updated.traceId).toBe('abc123');
    expect(props.onRunQuery).toHaveBeenCalled();
  });

  it('renders tags input in search mode', async () => {
    render(<QueryEditor {...makeProps({ queryType: 'search' })} />);
    await waitFor(() => {
      expect(screen.getByText('Tags')).toBeInTheDocument();
    });
  });
});
