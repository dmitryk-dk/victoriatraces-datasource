import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDataFrame, dateTime, EventBusSrv, FieldType, LoadingState, PanelProps } from '@grafana/data';
import { of } from 'rxjs';

import { TracePanel } from './TracePanel';
import { invalidateResources } from '../trace-ui/api/resource';
import { TraceChartSelectionEvent } from '../trace-ui/events/chartSelection';

// Renders the panel against a stubbed runtime. Covers what typecheck cannot:
// that the trace-list frame actually mounts the list, charts and preview.

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
  getDataSourceSrv: () => ({
    getList: () => [],
    getInstanceSettings: () => ({ jsonData: {} }),
  }),
  locationService: {
    getSearch: () => new URLSearchParams(),
    push: jest.fn(),
  },
}));

const from = dateTime('2026-08-18T10:00:00Z');
const to = dateTime('2026-08-18T11:00:00Z');

function traceListFrame() {
  return createDataFrame({
    name: 'trace_list',
    fields: [
      { name: 'traceID', type: FieldType.string, values: ['abc123', 'def456'] },
      { name: 'rootService', type: FieldType.string, values: ['checkout', 'frontend'] },
      { name: 'rootOperation', type: FieldType.string, values: ['POST /order', 'GET /'] },
      {
        name: 'services',
        type: FieldType.string,
        values: ['["checkout","payments"]', '["frontend"]'],
      },
      { name: 'startTime', type: FieldType.time, values: [from.valueOf(), from.valueOf() + 1000] },
      { name: 'durationMs', type: FieldType.number, values: [25, 400] },
      { name: 'spans', type: FieldType.number, values: [3, 2] },
      { name: 'errors', type: FieldType.number, values: [1, 0] },
      { name: 'partial', type: FieldType.boolean, values: [false, false] },
    ],
  });
}

function emptyTraceListFrame() {
  return createDataFrame({
    name: 'trace_list',
    fields: [
      { name: 'traceID', type: FieldType.string, values: [] },
      { name: 'rootService', type: FieldType.string, values: [] },
      { name: 'rootOperation', type: FieldType.string, values: [] },
      { name: 'services', type: FieldType.string, values: [] },
      { name: 'startTime', type: FieldType.time, values: [] },
      { name: 'durationMs', type: FieldType.number, values: [] },
      { name: 'spans', type: FieldType.number, values: [] },
      { name: 'errors', type: FieldType.number, values: [] },
      { name: 'partial', type: FieldType.boolean, values: [] },
    ],
  });
}

function makeProps(frames = [traceListFrame()], where = ''): PanelProps {
  return {
    data: {
      state: LoadingState.Done,
      series: frames,
      timeRange: { from, to, raw: { from, to } },
      request: {
        targets: [{ refId: 'A', datasource: { uid: 'test-uid' }, where }],
      },
    },
    width: 1200,
    height: 800,
    timeRange: { from, to, raw: { from, to } },
    options: {},
    fieldConfig: { defaults: {}, overrides: [] },
    eventBus: new EventBusSrv(),
  } as unknown as PanelProps;
}

beforeEach(() => {
  // The resource cache is module state; without this a test is served the
  // previous one's response and never issues its own request.
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
    if (url.includes('/resources/trace/')) {
      return of({
        data: {
          traceID: 'abc123',
          spans: [
            {
              traceID: 'abc123',
              spanID: 'span-1',
              operationName: 'POST /order',
              processID: 'p1',
              startTime: from.valueOf() * 1000,
              duration: 25_000,
              tags: [],
              logs: [],
              references: [],
            },
          ],
          processes: { p1: { serviceName: 'checkout', tags: [] } },
        },
      });
    }
    return of({ data: [] });
  });
});

describe('TracePanel trace list', () => {
  // Each trace id renders twice: the truncated cell and the hover copy overlay.
  it('renders a row per trace from the frame', async () => {
    render(<TracePanel {...makeProps()} />);

    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));
    expect(screen.getAllByText('def456').length).toBeGreaterThan(0);
    expect(screen.getByText('POST /order')).toBeInTheDocument();
  });

  it('shows the aggregated span and error counts', async () => {
    render(<TracePanel {...makeProps()} />);

    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));
    // Three spans, one of them errored.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('prompts for a query when there are no frames', () => {
    render(<TracePanel {...makeProps([])} />);
    expect(screen.getByText('Run a query to see traces.')).toBeInTheDocument();
  });

  describe('trace preview', () => {
    async function openPreview(props = makeProps()) {
      const view = render(<TracePanel {...props} />);
      await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByText('abc123')[0]);
      await waitFor(() => expect(screen.getByText('Trace Preview')).toBeInTheDocument());
      return view;
    }

    it('opens on a row click', async () => {
      await openPreview();
    });

    it('closes when the query changes', async () => {
      // The previewed trace may not match the new filters, and its stats were
      // computed against the old query.
      const { rerender } = await openPreview();

      rerender(<TracePanel {...makeProps([traceListFrame()], 'status_code:2')} />);

      await waitFor(() => expect(screen.queryByText('Trace Preview')).not.toBeInTheDocument());
    });

    it('closes when the time range changes', async () => {
      const { rerender } = await openPreview();

      const later = dateTime('2026-08-18T12:00:00Z');
      const props = makeProps();
      const shifted = {
        ...props,
        data: { ...props.data, timeRange: { from, to: later, raw: { from, to: later } } },
      } as unknown as PanelProps;
      rerender(<TracePanel {...shifted} />);

      await waitFor(() => expect(screen.queryByText('Trace Preview')).not.toBeInTheDocument());
    });

    it('stays open across an unrelated re-render', async () => {
      const { rerender } = await openPreview();

      rerender(<TracePanel {...makeProps()} />);

      expect(screen.getByText('Trace Preview')).toBeInTheDocument();
    });
  });

  describe('list states', () => {
    it('reports a failed query instead of an empty search', async () => {
      const props = makeProps([traceListFrame()]);
      const failed = {
        ...props,
        data: { ...props.data, state: LoadingState.Error, error: { message: 'upstream refused' }, series: [emptyTraceListFrame()] },
      } as unknown as PanelProps;

      render(<TracePanel {...failed} />);
      await waitFor(() => expect(screen.getByText(/upstream refused/)).toBeInTheDocument());
    });

    it('says the range is empty when the query returned nothing', async () => {
      const props = makeProps([emptyTraceListFrame()]);
      render(<TracePanel {...props} />);
      await waitFor(() => expect(screen.getByText('No traces in this time range.')).toBeInTheDocument());
    });

    it('reports a query still running', async () => {
      const props = makeProps([emptyTraceListFrame()]);
      const loading = {
        ...props,
        data: { ...props.data, state: LoadingState.Loading },
      } as unknown as PanelProps;

      render(<TracePanel {...loading} />);
      await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument());
    });
  });

  describe('pagination', () => {
    // jsdom never intersects anything, so the observer is captured and fired
    // by hand to stand in for the user scrolling to the bottom.
    let triggerIntersect: (() => void) | undefined;

    beforeEach(() => {
      triggerIntersect = undefined;
      global.IntersectionObserver = class {
        constructor(private cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          triggerIntersect = () => this.cb([{ isIntersecting: true }]);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    });

    function fullPageProps() {
      // The frame holds exactly the query's limit, so older traces may exist.
      const props = makeProps();
      (props.data.request!.targets[0] as { limit?: number }).limit = 2;
      return props;
    }

    it('offers more rows when the query filled its page', async () => {
      render(<TracePanel {...fullPageProps()} />);
      await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));
      expect(triggerIntersect).toBeDefined();
    });

    it('offers more even when the query carried no limit of its own', async () => {
      // The frame does not say what limit produced it, and guessing wrong
      // hides the affordance entirely. Offering costs one request that comes
      // back empty at the true end of the data.
      const props = makeProps();
      delete (props.data.request!.targets[0] as { limit?: number }).limit;
      render(<TracePanel {...props} />);
      await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));
      expect(triggerIntersect).toBeDefined();
    });

    it('offers nothing more when the query returned nothing', async () => {
      render(<TracePanel {...makeProps([emptyTraceListFrame()])} />);
      await waitFor(() =>
        expect(screen.getByText('No traces in this time range.')).toBeInTheDocument()
      );
      expect(triggerIntersect).toBeUndefined();
    });

    it('appends the next page after the rows the query returned', async () => {
      mockFetch.mockImplementation(({ url }: { url: string }) => {
        if (url.includes('/resources/trace_list')) {
          return of({
            data: [
              {
                traceID: 'older1',
                rootService: 'checkout',
                rootOperation: 'GET /cart',
                services: ['checkout'],
                startTime: new Date(from.valueOf() - 1000).toISOString(),
                durationMicros: 8000,
                spans: 2,
                errors: 0,
                partial: false,
              },
            ],
          });
        }
        return of({ data: [] });
      });

      render(<TracePanel {...fullPageProps()} />);
      await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

      act(() => triggerIntersect!());

      await waitFor(() => expect(screen.getAllByText('older1').length).toBeGreaterThan(0));
      // The rows the panel's own query returned are still there.
      expect(screen.getAllByText('abc123').length).toBeGreaterThan(0);
    });

    it('pages backwards from the oldest row it already shows', async () => {
      render(<TracePanel {...fullPageProps()} />);
      await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

      act(() => triggerIntersect!());

      await waitFor(() => {
        const req = mockFetch.mock.calls
          .map(([r]: [{ url: string }]) => r)
          .find((r: { url: string }) => r.url.includes('/resources/trace_list'));
        // def456 is the older of the two frame rows.
        expect(req?.url).toContain(encodeURIComponent(new Date(from.valueOf() + 1000).toISOString()));
      });
    });
  });

  describe('spans mode', () => {
    function spanListFrame() {
      return createDataFrame({
        name: 'span_list',
        fields: [
          { name: 'traceID', type: FieldType.string, values: ['abc123'] },
          { name: 'spanID', type: FieldType.string, values: ['span-9'] },
          { name: 'service', type: FieldType.string, values: ['payments'] },
          { name: 'operation', type: FieldType.string, values: ['Charge'] },
          { name: 'startTime', type: FieldType.time, values: [from.valueOf()] },
          { name: 'durationMs', type: FieldType.number, values: [12] },
          { name: 'kind', type: FieldType.string, values: ['3'] },
          { name: 'statusCode', type: FieldType.number, values: [2] },
        ],
      });
    }

    it('renders the span-level columns instead of the trace aggregates', async () => {
      render(<TracePanel {...makeProps([spanListFrame()])} />);

      await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Span ID' })).toBeInTheDocument());
      expect(screen.getByRole('columnheader', { name: 'Kind' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
      // Span and error counts are per-trace, so they have no column here.
      // Scoped to headers: the sidebar also has a "Spans" tab.
      expect(screen.queryByRole('columnheader', { name: 'Spans' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Errors' })).not.toBeInTheDocument();
    });

    it('shows the span, its kind and its status', async () => {
      render(<TracePanel {...makeProps([spanListFrame()])} />);

      await waitFor(() => expect(screen.getByText('span-9')).toBeInTheDocument());
      expect(screen.getByText('Charge')).toBeInTheDocument();
      expect(screen.getByText('Client')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('counts rows as spans', async () => {
      render(<TracePanel {...makeProps([spanListFrame()])} />);
      await waitFor(() => expect(screen.getByText('1 span')).toBeInTheDocument());
    });
  });

});

describe('TracePanel and the charts panel', () => {
  it('narrows the list to a window selected on the charts panel', async () => {
    // The charts are their own panel now, so a drawn window arrives on the
    // shared event bus rather than through panel state.
    const props = makeProps();
    const eventBus = (props as unknown as { eventBus: EventBusSrv }).eventBus;
    render(<TracePanel {...props} />);
    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

    act(() => {
      eventBus.publish(
        new TraceChartSelectionEvent({
          selection: {
            startMicros: from.valueOf() * 1000,
            endMicros: (from.valueOf() + 60_000) * 1000,
            minDurationMicros: 0,
            maxDurationMicros: Number.POSITIVE_INFINITY,
          },
        })
      );
    });

    await waitFor(() => {
      const drill = mockFetch.mock.calls.find(([req]: [{ url: string }]) =>
        req.url.includes('/resources/trace_list')
      );
      expect(drill).toBeDefined();
    });
  });

  it('drills to the window the selection covers, not the whole range', async () => {
    const props = makeProps();
    const eventBus = (props as unknown as { eventBus: EventBusSrv }).eventBus;
    render(<TracePanel {...props} />);
    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

    act(() => {
      eventBus.publish(
        new TraceChartSelectionEvent({
          selection: {
            startMicros: (from.valueOf() + 60_000) * 1000,
            endMicros: (from.valueOf() + 120_000) * 1000,
            minDurationMicros: 0,
            maxDurationMicros: Number.POSITIVE_INFINITY,
          },
        })
      );
    });

    await waitFor(() => {
      const req = mockFetch.mock.calls
        .map(([r]: [{ url: string }]) => r)
        .find((r: { url: string }) => r.url.includes('/resources/trace_list'));
      const params = new URL(req!.url, 'http://x').searchParams;
      // The panel's own range is 10:00-11:00; the drill covers one minute of it.
      expect(new Date(params.get('start')!).valueOf()).toBe(from.valueOf() + 60_000);
      expect(new Date(params.get('end')!).valueOf()).toBe(from.valueOf() + 120_000);
    });
  });

  it('goes back to the frame rows when the selection is cleared', async () => {
    const props = makeProps();
    const eventBus = (props as unknown as { eventBus: EventBusSrv }).eventBus;
    render(<TracePanel {...props} />);
    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

    // The drill endpoint returns nothing for this window.
    act(() => {
      eventBus.publish(
        new TraceChartSelectionEvent({
          selection: {
            startMicros: from.valueOf() * 1000,
            endMicros: (from.valueOf() + 1_000) * 1000,
            minDurationMicros: 0,
            maxDurationMicros: Number.POSITIVE_INFINITY,
          },
        })
      );
    });
    await waitFor(() => expect(screen.queryAllByText('def456')).toHaveLength(0));

    act(() => {
      eventBus.publish(new TraceChartSelectionEvent({ selection: null }));
    });

    await waitFor(() => expect(screen.getAllByText('def456').length).toBeGreaterThan(0));
  });

  it('no longer draws the charts itself', async () => {
    render(<TracePanel {...makeProps()} />);
    await waitFor(() => expect(screen.getAllByText('abc123').length).toBeGreaterThan(0));

    expect(screen.queryByLabelText('Trace volume by duration')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Heatmap' })).not.toBeInTheDocument();
  });
});
