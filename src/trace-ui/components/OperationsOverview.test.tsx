import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { OperationStat } from '../api/traceList';
import { OperationsOverview } from './OperationsOverview';

const stats: OperationStat[] = [
  { operation: 'GET /cart', spans: 4, avgDurationMicros: 489_050, errors: 2 },
  { operation: 'PUT /order', spans: 10, avgDurationMicros: 580_144, errors: 0 },
  { operation: 'POST /order', spans: 7, avgDurationMicros: 120_464, errors: 0 },
];

function renderOverview(overrides: Partial<React.ComponentProps<typeof OperationsOverview>> = {}) {
  const props = {
    services: ['frontend', 'payments'],
    service: 'frontend',
    onServiceChange: jest.fn(),
    stats,
    loading: false,
    ...overrides,
  };
  render(<OperationsOverview {...props} />);
  return props;
}

function operationOrder(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    // Cell text runs together in textContent, so the path must stop at the
    // first non-letter rather than swallowing the span count after it.
    .map((row) => row.textContent?.match(/(?:GET|PUT|POST) \/[a-z]+/)?.[0] ?? '');
}

describe('OperationsOverview', () => {
  it('sorts by span count, busiest first', () => {
    renderOverview();
    expect(operationOrder()).toEqual(['PUT /order', 'POST /order', 'GET /cart']);
  });

  it('sorts operation names ascending but counts descending', () => {
    renderOverview();

    fireEvent.click(screen.getByText('Operation'));
    expect(operationOrder()).toEqual(['GET /cart', 'POST /order', 'PUT /order']);

    fireEvent.click(screen.getByText('Avg duration'));
    expect(operationOrder()).toEqual(['PUT /order', 'GET /cart', 'POST /order']);
  });

  it('reverses when the same column is clicked twice', () => {
    renderOverview();
    fireEvent.click(screen.getByText('Spans'));
    expect(operationOrder()).toEqual(['GET /cart', 'POST /order', 'PUT /order']);
  });

  it('drills into an operation when its row is clicked', () => {
    const onSelectOperation = jest.fn();
    renderOverview({ onSelectOperation });

    fireEvent.click(screen.getByText('GET /cart'));
    expect(onSelectOperation).toHaveBeenCalledWith('GET /cart');
  });

  it('prompts for a service when none is selected', () => {
    renderOverview({ service: undefined, stats: [] });
    expect(screen.getByText('Pick a service to see its operations.')).toBeInTheDocument();
  });

  it('explains a service with no operations in range', () => {
    renderOverview({ stats: [] });
    expect(screen.getByText(/No operations for this service/)).toBeInTheDocument();
  });

  it('surfaces a failure without hiding the picker', () => {
    renderOverview({ stats: [], error: new Error('boom') });
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByLabelText('Service')).toBeInTheDocument();
  });
});

describe('truncation', () => {
  it('says when the backend capped the list', () => {
    // A service naming operations dynamically can exceed the cap; showing the
    // first N silently reads as the complete picture.
    renderOverview({ truncated: true });
    expect(screen.getByText(/only the busiest/i)).toBeInTheDocument();
  });

  it('says nothing when the list is complete', () => {
    renderOverview();
    expect(screen.queryByText(/only the busiest/i)).not.toBeInTheDocument();
  });
});
