import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { SpanDetails } from './SpanDetails';
import type { Trace, TraceSpan } from '../types';

const writeText = jest.fn().mockResolvedValue(undefined);

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

beforeEach(() => {
  writeText.mockClear();
});

const span: TraceSpan = {
  traceID: 't',
  spanID: 's',
  operationName: 'POST /order',
  processID: 'p',
  startTime: 0,
  duration: 10,
  logs: [],
  references: [],
  tags: [
    { key: 'http.method', value: 'GET' },
    { key: 'http.route', value: '/checkout' },
    { key: 'db.system', value: 'postgres' },
    { key: 'error', value: 'true' },
  ],
};

const trace: Trace = { traceID: 't', spans: [span], processes: { p: { serviceName: 'checkout', tags: [] } } };

function renderDetails() {
  render(<SpanDetails trace={trace} span={span} />);
}

describe('SpanDetails fields', () => {
  it('groups attributes by their namespace', () => {
    // A span with dozens of attributes is unreadable as one flat list.
    renderDetails();
    expect(screen.getByText('http')).toBeInTheDocument();
    expect(screen.getByText('db')).toBeInTheDocument();
  });

  it('narrows the list as you search', () => {
    renderDetails();

    fireEvent.change(screen.getByLabelText('Filter fields'), { target: { value: 'db' } });

    expect(screen.getByText('db.system')).toBeInTheDocument();
    expect(screen.queryByText('http.method')).not.toBeInTheDocument();
  });

  it('searches values as well as names', () => {
    renderDetails();

    fireEvent.change(screen.getByLabelText('Filter fields'), { target: { value: 'postgres' } });

    expect(screen.getByText('db.system')).toBeInTheDocument();
    expect(screen.queryByText('http.route')).not.toBeInTheDocument();
  });

  it('says when a search matches nothing', () => {
    renderDetails();

    fireEvent.change(screen.getByLabelText('Filter fields'), { target: { value: 'nothing-here' } });

    expect(screen.getByText('No fields match this filter.')).toBeInTheDocument();
  });

  it('copies a value to the clipboard', () => {
    renderDetails();

    fireEvent.click(screen.getByRole('button', { name: 'Copy http.route' }));

    expect(writeText).toHaveBeenCalledWith('/checkout');
  });
});
