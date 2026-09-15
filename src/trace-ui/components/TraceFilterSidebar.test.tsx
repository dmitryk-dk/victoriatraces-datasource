import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { OPERATION_FIELD, SERVICE_FIELD, type Facet } from '../api/traceList';
import { TraceFilterSidebar } from './TraceFilterSidebar';

const facets: Facet[] = [
  {
    field: SERVICE_FIELD,
    values: [
      { value: 'frontend', count: 2903 },
      { value: 'cart', count: 964 },
    ],
  },
  {
    field: OPERATION_FIELD,
    values: [{ value: 'user_browse_product', count: 700 }],
  },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof TraceFilterSidebar>> = {}) {
  const props = {
    facets,
    loading: false,
    services: [],
    filters: [],
    entity: 'traces' as const,
    onEntityChange: jest.fn(),
    onServicesChange: jest.fn(),
    onFiltersChange: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(<TraceFilterSidebar {...props} />);
  return props;
}

describe('TraceFilterSidebar', () => {
  it('lists each value with the number of traces carrying it', () => {
    renderSidebar();
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('2903')).toBeInTheDocument();
    expect(screen.getByText('cart')).toBeInTheDocument();
    expect(screen.getByText('964')).toBeInTheDocument();
  });

  it('shows how many values each group has', () => {
    renderSidebar();
    // Service has two values, Operation one.
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('adds a service on select', () => {
    const onServicesChange = jest.fn();
    renderSidebar({ onServicesChange });
    fireEvent.click(screen.getByText('frontend'));
    expect(onServicesChange).toHaveBeenCalledWith(['frontend']);
  });

  it('removes a service that is already selected', () => {
    const onServicesChange = jest.fn();
    renderSidebar({ services: ['frontend'], onServicesChange });
    fireEvent.click(screen.getByText('frontend'));
    expect(onServicesChange).toHaveBeenCalledWith([]);
  });

  it('toggles an operation filter', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText('user_browse_product'));
    expect(props.onFiltersChange).toHaveBeenCalledWith([
      { kind: 'operation', value: 'user_browse_product' },
    ]);
  });

  it('toggles errors only', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByText('Errors only'));
    expect(props.onFiltersChange).toHaveBeenCalledWith([{ kind: 'error' }]);
  });

  it('removes the error filter when it is already on', () => {
    const props = renderSidebar({ filters: [{ kind: 'error' }] });
    fireEvent.click(screen.getByText('Errors only'));
    expect(props.onFiltersChange).toHaveBeenCalledWith([]);
  });

  it('switches entity from its tabs', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: /Spans/ }));
    expect(props.onEntityChange).toHaveBeenCalledWith('spans');
  });

  it('marks the active entity tab', () => {
    renderSidebar({ entity: 'spans' });
    expect(screen.getByRole('tab', { name: /Spans/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Traces/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('collapses a group', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Service/ }));
    expect(screen.queryByText('frontend')).not.toBeInTheDocument();
  });

  it('offers a search box only once a group is long', () => {
    renderSidebar();
    expect(screen.queryByLabelText('Search Service values')).not.toBeInTheDocument();

    const many = Array.from({ length: 12 }, (_, i) => ({ value: `svc-${i}`, count: i }));
    renderSidebar({ facets: [{ field: SERVICE_FIELD, values: many }] });
    expect(screen.getByLabelText('Search Service values')).toBeInTheDocument();
  });

  it('keeps a selected value visible past the cut-off', () => {
    // svc-11 sits beyond the first eight, but it is an active filter.
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `svc-${i}`, count: i }));
    renderSidebar({ facets: [{ field: SERVICE_FIELD, values: many }], services: ['svc-11'] });
    expect(screen.getByText('svc-11')).toBeInTheDocument();
  });
});

describe('TraceFilterSidebar scoping and bulk actions', () => {
  const many: Facet[] = [
    {
      field: SERVICE_FIELD,
      values: Array.from({ length: 12 }, (_, i) => ({ value: `svc-${i}`, count: 100 - i })),
    },
  ];

  it('dims a value the other filters rule out', () => {
    renderSidebar({
      facets: [
        {
          field: SERVICE_FIELD,
          values: [
            { value: 'frontend', count: 10, inScope: true },
            { value: 'cart', count: 4, inScope: false },
          ],
        },
      ],
    });

    expect(screen.getByTitle(/no traces under the current filters/i)).toBeInTheDocument();
  });

  it('shows the busiest values first', () => {
    renderSidebar({ facets: many });
    expect(screen.getByText('svc-0')).toBeInTheDocument();
    // Ranked 12th of 12, so it is behind the "show more" control.
    expect(screen.queryByText('svc-11')).not.toBeInTheDocument();
  });

  it('reveals the rest on demand rather than hiding them for good', () => {
    renderSidebar({ facets: many });

    fireEvent.click(screen.getByRole('button', { name: /show 4 more/i }));
    expect(screen.getByText('svc-11')).toBeInTheDocument();
  });

  it('clears a whole facet at once', () => {
    const onServicesChange = jest.fn();
    renderSidebar({ services: ['frontend', 'cart'], onServicesChange });

    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected services' }));
    expect(onServicesChange).toHaveBeenCalledWith([]);
  });

  it('offers no bulk clear when nothing is selected', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Clear .* selected/ })).not.toBeInTheDocument();
  });

  it('filters by duration without leaving the panel', () => {
    const onFiltersChange = jest.fn();
    renderSidebar({ onFiltersChange });

    fireEvent.change(screen.getByLabelText('Minimum duration'), { target: { value: '250ms' } });
    fireEvent.blur(screen.getByLabelText('Minimum duration'));

    expect(onFiltersChange).toHaveBeenCalledWith([{ kind: 'duration', min: '250ms', max: undefined }]);
  });

  it('shows the duration filter already in force', () => {
    renderSidebar({ filters: [{ kind: 'duration', min: '250ms', max: '2s' }] });

    expect(screen.getByLabelText('Minimum duration')).toHaveValue('250ms');
    expect(screen.getByLabelText('Maximum duration')).toHaveValue('2s');
  });

  it('clears a duration filter set from a chart drill', () => {
    // The heatmap can write a duration filter; without a control here it can
    // only be removed by editing the query.
    const onFiltersChange = jest.fn();
    renderSidebar({ filters: [{ kind: 'duration', min: '250ms' }], onFiltersChange });

    fireEvent.click(screen.getByRole('button', { name: 'Clear duration filter' }));
    expect(onFiltersChange).toHaveBeenCalledWith([]);
  });
});

describe('TraceFilterSidebar tag filters', () => {
  it('lists the tag filters in force', () => {
    renderSidebar({ filters: [{ kind: 'tag', key: 'http.method', value: 'GET' }] });
    expect(screen.getByText('http.method=GET')).toBeInTheDocument();
  });

  it('adds a tag filter without leaving the panel', () => {
    const onFiltersChange = jest.fn();
    renderSidebar({ onFiltersChange, tagKeys: ['http.method'] });

    fireEvent.change(screen.getByLabelText('Tag key'), { target: { value: 'http.method' } });
    fireEvent.change(screen.getByLabelText('Tag value'), { target: { value: 'GET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag filter' }));

    expect(onFiltersChange).toHaveBeenCalledWith([{ kind: 'tag', key: 'http.method', value: 'GET' }]);
  });

  it('replaces a tag already filtered on the same key', () => {
    // Two equality filters on one key are ANDed and match nothing.
    const onFiltersChange = jest.fn();
    renderSidebar({ filters: [{ kind: 'tag', key: 'http.method', value: 'GET' }], onFiltersChange });

    fireEvent.change(screen.getByLabelText('Tag key'), { target: { value: 'http.method' } });
    fireEvent.change(screen.getByLabelText('Tag value'), { target: { value: 'POST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag filter' }));

    expect(onFiltersChange).toHaveBeenCalledWith([{ kind: 'tag', key: 'http.method', value: 'POST' }]);
  });

  it('will not add a half-filled tag', () => {
    const onFiltersChange = jest.fn();
    renderSidebar({ onFiltersChange });

    fireEvent.change(screen.getByLabelText('Tag key'), { target: { value: 'http.method' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag filter' }));

    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it('removes a tag filter', () => {
    const onFiltersChange = jest.fn();
    renderSidebar({ filters: [{ kind: 'tag', key: 'http.method', value: 'GET' }], onFiltersChange });

    fireEvent.click(screen.getByRole('button', { name: 'Remove http.method=GET' }));
    expect(onFiltersChange).toHaveBeenCalledWith([]);
  });
});
