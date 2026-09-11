import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDataFrame, dateTime, EventBusSrv, LoadingState, PanelProps } from '@grafana/data';
import { of } from 'rxjs';

import { TraceChartsPanel } from './TraceChartsPanel';
import { invalidateResources } from '../trace-ui/api/resource';
import { TraceChartSelectionEvent } from '../trace-ui/events/chartSelection';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
  getDataSourceSrv: () => ({ getList: () => [], getInstanceSettings: () => ({ jsonData: {} }) }),
  locationService: { getSearch: () => new URLSearchParams(), push: jest.fn() },
}));

const from = dateTime('2026-08-18T10:00:00Z');
const to = dateTime('2026-08-18T11:00:00Z');

function chartsFrame() {
  return createDataFrame({
    name: 'trace_charts',
    fields: [],
    meta: { custom: { datasourceUid: 'test-uid' } },
  });
}

function makeProps(eventBus = new EventBusSrv()): PanelProps {
  return {
    data: {
      state: LoadingState.Done,
      series: [chartsFrame()],
      timeRange: { from, to, raw: { from, to } },
      request: { targets: [{ refId: 'A', datasource: { uid: 'test-uid' }, where: '' }] },
    },
    width: 900,
    height: 342,
    timeRange: { from, to, raw: { from, to } },
    options: {},
    fieldConfig: { defaults: {}, overrides: [] },
    eventBus,
    onChangeTimeRange: jest.fn(),
  } as unknown as PanelProps;
}

beforeEach(() => {
  invalidateResources();
  mockFetch.mockReset();
  mockFetch.mockImplementation(({ url }: { url: string }) => {
    if (url.includes('/heatmap')) {
      return of({
        data: {
          cells: [
            { xi: 0, yi: 1, count: 5, errors: 0 },
            { xi: 2, yi: 2, count: 2, errors: 1 },
          ],
          xCount: 5,
          stepMs: 60_000,
          startMs: from.valueOf(),
          yEdgesNs: [3_000_000, 10_000_000],
        },
      });
    }
    return of({ data: [] });
  });
});

describe('TraceChartsPanel', () => {
  it('draws the charts from the datasource named in its frame', async () => {
    render(<TraceChartsPanel {...makeProps()} />);

    await waitFor(() => expect(screen.getByLabelText('Trace volume by duration')).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: 'Heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Scatter' })).toBeInTheDocument();
  });

  it('publishes a selection so the trace list can narrow to it', async () => {
    // The list lives in another panel now; the bus is what they share.
    const eventBus = new EventBusSrv();
    const seen: Array<TraceChartSelectionEvent['payload']> = [];
    eventBus.subscribe(TraceChartSelectionEvent, (e) => seen.push(e.payload));

    render(<TraceChartsPanel {...makeProps(eventBus)} />);
    await waitFor(() => expect(screen.getByLabelText('Trace volume by duration')).toBeInTheDocument());

    const plot = screen.getByLabelText('Trace volume by duration');
    plot.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 48, right: 300, bottom: 48, x: 0, y: 0 }) as DOMRect;
    fireEvent.pointerDown(plot, { clientX: 10, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(plot, { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(plot, { clientX: 100, clientY: 20, pointerId: 1 });

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].selection).not.toBeNull();
    expect(seen[0].selection!.endMicros).toBeGreaterThan(seen[0].selection!.startMicros);
  });

  it('renders the grid, legend and density scale', async () => {
    render(<TraceChartsPanel {...makeProps()} />);

    // The duration axis labels five positions up the bands.
    await waitFor(() => expect(document.querySelectorAll('[data-testid="duration-tick"]')).toHaveLength(5));
    expect(screen.getByRole('button', { name: 'Errors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    expect(screen.getByText('5 traces (max)')).toBeInTheDocument();
  });

  it('collapses and restores the chart', async () => {
    render(<TraceChartsPanel {...makeProps()} />);
    await waitFor(() => expect(screen.getByText('Heatmap')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Hide chart'));
    expect(screen.queryByText('Heatmap')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show chart'));
    expect(screen.getByText('Heatmap')).toBeInTheDocument();
  });

  it('samples the scatter plot independently of any table', async () => {
    // Its own spread sample: a newest-first page would put every point on the
    // right-hand edge.
    render(<TraceChartsPanel {...makeProps()} />);
    await waitFor(() => expect(screen.getByText('Scatter')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Scatter'));

    await waitFor(() => {
      const req = mockFetch.mock.calls
        .map(([r]: [{ url: string }]) => r)
        .find((r: { url: string }) => r.url.includes('/resources/trace_sample'));
      expect(req?.url).toContain('limit=1000');
    });
  });

  it('says so when the query has not run yet', () => {
    const props = makeProps();
    (props.data as { series: unknown[] }).series = [];
    render(<TraceChartsPanel {...props} />);

    expect(screen.getByText('Run a trace search to see its charts.')).toBeInTheDocument();
  });
});
