import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { TracesScatterPlot } from './TracesScatterPlot';
import type { TraceListRow } from '../api/traceList';

const START_MS = Date.UTC(2026, 7, 18, 10, 0, 0);
const END_MS = START_MS + 100_000;
const WIDTH = 200;
const HEIGHT = 100;

function row(traceID: string, offsetMs: number, durationMicros: number, spans = 3): TraceListRow {
  return {
    traceID,
    rootService: 'checkout',
    rootOperation: 'POST /order',
    services: ['checkout'],
    startTime: new Date(START_MS + offsetMs).toISOString(),
    durationMicros,
    spans,
    errors: 0,
    partial: false,
  };
}

const rows = [row('fast', 0, 1000), row('slow', 50_000, 100_000)];

function renderPlot(props: Partial<React.ComponentProps<typeof TracesScatterPlot>> = {}) {
  const onSelectionChange = jest.fn();
  const onZoom = jest.fn();
  render(
    <TracesScatterPlot
      rows={rows}
      startMs={START_MS}
      endMs={END_MS}
      onSelectionChange={onSelectionChange}
      onZoom={onZoom}
      {...props}
    />
  );
  const plot = screen.getByLabelText('Trace duration over time');
  plot.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect;
  return { plot, onSelectionChange, onZoom };
}

function drag(plot: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(plot, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
  fireEvent.pointerMove(plot, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(plot, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

describe('TracesScatterPlot', () => {
  it('plots a dot per trace', () => {
    renderPlot();
    expect(screen.getByLabelText('Trace fast')).toBeInTheDocument();
    expect(screen.getByLabelText('Trace slow')).toBeInTheDocument();
  });

  it('sizes each dot by its span count', () => {
    // visum reads bubble size as span count; a fixed dot loses that.
    render(
      <TracesScatterPlot rows={[row('a', 0, 1000, 1), row('b', 10, 2000, 100)]} startMs={START_MS} endMs={END_MS} />
    );
    const small = screen.getByLabelText('Trace a');
    const large = screen.getByLabelText('Trace b');
    expect(parseFloat(large.style.width)).toBeGreaterThan(parseFloat(small.style.width));
  });

  it('explains the bubble size in the legend', () => {
    renderPlot();
    expect(screen.getByText(/span count/i)).toBeInTheDocument();
  });

  it('selects the window a drag covers', () => {
    const { plot, onSelectionChange } = renderPlot();
    drag(plot, [50, 25], [150, 75]);

    const selection = onSelectionChange.mock.calls[0][0];
    expect(selection.startMicros).toBe((START_MS + 25_000) * 1000);
    expect(selection.endMicros).toBe((START_MS + 75_000) * 1000);
    expect(selection.maxDurationMicros).toBeLessThan(100_000);
    expect(selection.minDurationMicros).toBeGreaterThan(1000);
  });

  it('leaves a click to select the trace under it, not a window', () => {
    const { plot, onSelectionChange } = renderPlot();
    drag(plot, [50, 25], [51, 26]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('draws a selection made on the other chart', () => {
    renderPlot({
      selection: {
        startMicros: START_MS * 1000,
        endMicros: (START_MS + 50_000) * 1000,
        minDurationMicros: 0,
        maxDurationMicros: Infinity,
      },
    });
    expect(screen.getByLabelText('Selected window')).toBeInTheDocument();
  });

  it('offers to zoom into a committed selection', () => {
    const selection = {
      startMicros: START_MS * 1000,
      endMicros: (START_MS + 50_000) * 1000,
      minDurationMicros: 2000,
      maxDurationMicros: 50_000,
    };
    const { onZoom } = renderPlot({ selection });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoom).toHaveBeenCalledWith(selection);
  });

  it('has nothing to zoom into without a selection', () => {
    renderPlot();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });

  it('says when the sample was cut short', () => {
    // The plot draws a sample, not the whole range; silently showing part of
    // it would misrepresent the density.
    render(<TracesScatterPlot rows={rows} startMs={START_MS} endMs={END_MS} truncated />);
    expect(screen.getByText('2 traces (sampled)')).toBeInTheDocument();
  });

  it('reports how much of the sample is shown', () => {
    render(<TracesScatterPlot rows={rows} startMs={START_MS} endMs={END_MS} total={4210} />);
    expect(screen.getByText('2 of 4210 traces')).toBeInTheDocument();
  });
});

/** How far up the axis a label sits, in percent, however it is anchored. */
function axisPos(el: HTMLElement): number {
  if (el.style.top === '0px') {
    return 100;
  }
  if (el.style.bottom === '0px') {
    return 0;
  }
  return parseFloat(el.style.bottom);
}

describe('TracesScatterPlot axes', () => {
  it('labels the duration axis at round values, not just the extremes', () => {
    // Two labels (the fastest and slowest trace loaded) give no scale to read
    // a dot against; visum's log axis ticks round durations.
    renderPlot({ rows: [row('a', 0, 1_000), row('b', 90_000, 1_000_000)] });
    const ticks = [...document.querySelectorAll<HTMLElement>('[data-testid="duration-tick"]')];

    expect(ticks.length).toBeGreaterThan(2);
    const slowest = Math.max(...ticks.map((t) => Number(t.dataset.micros)));
    const fastest = Math.min(...ticks.map((t) => Number(t.dataset.micros)));
    const bottomOf = (micros: number) =>
      axisPos(ticks.find((t) => Number(t.dataset.micros) === micros)!);
    expect(bottomOf(slowest)).toBeGreaterThan(bottomOf(fastest));
  });

  it('labels the time axis with clock times', () => {
    // Without an x axis a dot's position tells you nothing about when it ran.
    renderPlot();
    const ticks = [...document.querySelectorAll<HTMLElement>('[data-testid="time-tick"]')];

    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.textContent).toMatch(/^\d{2}:\d{2}(:\d{2})?$/);
      const left = parseFloat(tick.style.left);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(100);
    }
  });
});

describe('TracesScatterPlot axis edges', () => {
  it('pins a label at the very top inside the plot instead of centring it', () => {
    // Centring a label on its tick puts half of the topmost one above the
    // plot, where it collides with whatever sits above the chart.
    renderPlot({ rows: [row('a', 0, 1_000), row('b', 90_000, 1_000_000)] });
    const ticks = [...document.querySelectorAll<HTMLElement>('[data-testid="duration-tick"]')];
    const top = ticks.reduce((a, b) => (Number(b.dataset.micros) > Number(a.dataset.micros) ? b : a));

    expect(axisPos(top)).toBe(100);
    expect(top.style.top).toBe('0px');
    expect(top.style.transform).toBe('none');

    // Every other label is centred on its own tick, inside the axis.
    for (const tick of ticks.filter((t) => t !== top)) {
      expect(axisPos(tick)).toBeGreaterThanOrEqual(0);
      expect(axisPos(tick)).toBeLessThan(100);
    }
  });

  it('keeps the first and last time labels inside the plot', () => {
    renderPlot();
    const ticks = [...document.querySelectorAll<HTMLElement>('[data-testid="time-tick"]')];
    const first = ticks[0];
    const last = ticks[ticks.length - 1];

    if (parseFloat(first.style.left) === 0) {
      expect(first.style.transform).toBe('none');
    }
    if (last.style.right === '0px') {
      expect(last.style.transform).toBe('none');
    }
    // Whatever the range, no label may hang off either side.
    for (const tick of ticks) {
      const left = parseFloat(tick.style.left);
      expect(Number.isNaN(left) || (left >= 0 && left <= 100)).toBe(true);
    }
  });
});

describe('TracesScatterPlot axis alignment', () => {
  it('measures the duration axis against the plot, not a fixed height', () => {
    // The plot flexes to the height the panel leaves it. An axis with its own
    // fixed height drifts out of step, stranding the bottom label below the
    // plot floor.
    renderPlot();
    const plot = screen.getByLabelText('Trace duration over time');
    const tick = document.querySelector<HTMLElement>('[data-testid="duration-tick"]')!;
    const axis = tick.parentElement!;

    expect(axis.style.height).toBe('');
    expect(plot.style.height).toBe('');
    // Same row, so the two boxes stretch to one another.
    expect(axis.parentElement).toBe(plot.parentElement);
  });
});
