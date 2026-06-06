import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryEditor } from './QueryEditor';
import { defaultQuery, VictoriaTracesQuery } from '../types';
import { DataSource } from '../datasource';

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

  it('renders in search mode by default', async () => {
    render(<QueryEditor {...makeProps()} />);
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
