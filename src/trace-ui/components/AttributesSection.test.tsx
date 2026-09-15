import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { TraceSpan } from '../../panel/types';
import { AttributesSection } from './AttributesSection';

function span(tags: Array<{ key: string; value: unknown }>): TraceSpan {
  return {
    traceID: 't',
    spanID: 's',
    operationName: 'op',
    processID: 'p',
    startTime: 0,
    duration: 1,
    references: [],
    logs: [],
    tags,
  };
}

describe('AttributesSection', () => {
  it('lists attributes with their values', () => {
    render(<AttributesSection span={span([{ key: 'http.status_code', value: '500' }])} loading={false} />);
    expect(screen.getByText('http.status_code')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('labels where each attribute came from', () => {
    render(
      <AttributesSection
        span={span([
          { key: 'http.route', value: '/order' },
          { key: 'k8s.pod.name', value: 'pod-7' },
          { key: 'span.kind', value: 'server' },
        ])}
        loading={false}
      />
    );
    expect(screen.getByText('Span')).toBeInTheDocument();
    expect(screen.getByText('Resource')).toBeInTheDocument();
    expect(screen.getByText('Meta')).toBeInTheDocument();
  });

  it('distinguishes an empty value from a missing attribute', () => {
    render(<AttributesSection span={span([{ key: 'note', value: '' }])} loading={false} />);
    expect(screen.getByText('Empty string')).toBeInTheDocument();
  });

  it('shows a preview and expands in place', () => {
    const tags = Array.from({ length: 8 }, (_, i) => ({ key: `attr.${i}`, value: String(i) }));
    render(<AttributesSection span={span(tags)} loading={false} />);

    expect(screen.getByText('attr.0')).toBeInTheDocument();
    expect(screen.queryByText('attr.7')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('3 more attributes'));
    expect(screen.getByText('attr.7')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Show less'));
    expect(screen.queryByText('attr.7')).not.toBeInTheDocument();
  });

  it('explains a span with no attributes', () => {
    render(<AttributesSection span={span([])} loading={false} />);
    expect(screen.getByText(/No attributes on this trace/)).toBeInTheDocument();
  });

  it('shows a loading state before the trace arrives', () => {
    render(<AttributesSection span={undefined} loading={true} />);
    expect(screen.getByText('Loading attributes…')).toBeInTheDocument();
  });
});
