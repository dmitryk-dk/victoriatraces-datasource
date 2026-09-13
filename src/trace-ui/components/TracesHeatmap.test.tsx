import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { HeatmapData } from '../api/traceList';
import { TracesHeatmap } from './TracesHeatmap';

// Two edges → three bins: below 3ms, 3–10ms, and 10ms upwards.
const EDGES_NS = [3_000_000, 10_000_000];

function data(overrides: Partial<HeatmapData> = {}): HeatmapData {
  return {
    cells: [
      { xi: 0, yi: 0, count: 5, errors: 0 },
      { xi: 1, yi: 1, count: 2, errors: 1 },
      { xi: 2, yi: 2, count: 1, errors: 0 },
    ],
    xCount: 3,
    stepMs: 60_000,
    startMs: Date.UTC(2026, 7, 18, 10, 0, 0),
    yEdgesNs: EDGES_NS,
    ...overrides,
  };
}

describe('TracesHeatmap', () => {
  it('renders every duration band, populated or not', () => {
    // A band keeps its position on screen whatever the data holds, so the same
    // duration always sits at the same height between refreshes.
    const { container } = render(
      <TracesHeatmap data={data({ cells: [{ xi: 0, yi: 1, count: 3, errors: 0 }] })} />
    );
    // Two edges → three bands, only one of which holds a cell.
    expect(container.querySelectorAll('[data-testid="band-row"]')).toHaveLength(3);
  });

  it('fills the height it is given rather than a fixed one', () => {
    // The charts have their own panel now, so the grid takes the height the
    // panel offers instead of the 120px it was capped at to spare the list.
    // The label column has to track it, or the labels drift off the bands.
    render(<TracesHeatmap data={data()} />);
    const plot = screen.getByLabelText('Trace volume by duration');
    const tick = document.querySelector<HTMLElement>('[data-testid="duration-tick"]')!;

    expect(plot.style.height).toBe('');
    expect(tick.parentElement!.style.height).toBe('');
    expect(tick.parentElement!.parentElement).toBe(plot.parentElement);
  });

  it('explains an empty range', () => {
    render(<TracesHeatmap data={data({ cells: [] })} />);
    expect(screen.getByText('No traces in this range.')).toBeInTheDocument();
  });

  it('tolerates a payload missing its cells', () => {
    // A bad response must not take the whole panel down.
    render(<TracesHeatmap data={{} as HeatmapData} />);
    expect(screen.getByText('No traces in this range.')).toBeInTheDocument();
  });

  describe('legend and scale', () => {
    it('labels both kinds and reports the busiest cell', () => {
      render(<TracesHeatmap data={data()} />);
      expect(screen.getByText('Errors')).toBeInTheDocument();
      expect(screen.getByText('OK')).toBeInTheDocument();
      // The busiest cell in the fixture holds five traces.
      expect(screen.getByText('5 traces (max)')).toBeInTheDocument();
    });

    it('isolates one kind and restores on a second click', () => {
      render(<TracesHeatmap data={data()} />);
      const errors = screen.getByText('Errors');

      fireEvent.click(errors);
      expect(errors.closest('button')).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(errors);
      expect(errors.closest('button')).toHaveAttribute('aria-pressed', 'false');
    });

    it('isolating one kind releases the other', () => {
      render(<TracesHeatmap data={data()} />);
      fireEvent.click(screen.getByText('Errors'));
      fireEvent.click(screen.getByText('OK'));

      expect(screen.getByText('OK').closest('button')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Errors').closest('button')).toHaveAttribute('aria-pressed', 'false');
    });

    it('says "trace" in the singular', () => {
      render(<TracesHeatmap data={data({ cells: [{ xi: 0, yi: 1, count: 1, errors: 0 }] })} />);
      expect(screen.getByText('1 trace (max)')).toBeInTheDocument();
    });
  });

  it('labels the time axis with clock times', () => {
    render(<TracesHeatmap data={data({ xCount: 60, stepMs: 60_000 })} />);
    // A one-hour span at one-minute steps ticks on round clock minutes.
    expect(screen.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThan(0);
  });


  describe('selection', () => {
    const START = Date.UTC(2026, 7, 18, 10, 0, 0);
    const WIDTH = 300;
    const HEIGHT = 48;

    function renderPlot(props: Partial<React.ComponentProps<typeof TracesHeatmap>> = {}) {
      const onSelect = jest.fn();
      render(<TracesHeatmap data={data()} onSelectionChange={onSelect} {...props} />);
      const plot = screen.getByLabelText('Trace volume by duration');
      // jsdom lays nothing out, so the plot is given a size to measure.
      plot.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect;
      return { plot, onSelect };
    }

    function drag(plot: HTMLElement, from: [number, number], to: [number, number]) {
      fireEvent.pointerDown(plot, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
      fireEvent.pointerMove(plot, { clientX: to[0], clientY: to[1], pointerId: 1 });
      fireEvent.pointerUp(plot, { clientX: to[0], clientY: to[1], pointerId: 1 });
    }

    it('drills the exact cell under a click', () => {
      // Bucket 1 of three across 300px; the middle band of three across 48px.
      const { plot, onSelect } = renderPlot();
      drag(plot, [150, 20], [150, 20]);

      expect(onSelect).toHaveBeenCalledWith({
        startMicros: (START + 60_000) * 1000,
        endMicros: (START + 120_000) * 1000,
        minDurationMicros: 3000,
        maxDurationMicros: 10_000,
      });
    });

    it('clears when the click lands on an empty cell', () => {
      const { plot, onSelect } = renderPlot();
      drag(plot, [250, 20], [250, 20]);
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('selects every bucket and band a drag covers', () => {
      const { plot, onSelect } = renderPlot();
      drag(plot, [50, 40], [250, 20]);

      expect(onSelect).toHaveBeenCalledWith({
        startMicros: START * 1000,
        endMicros: (START + 180_000) * 1000,
        minDurationMicros: 0,
        maxDurationMicros: 10_000,
      });
    });

    it('draws the committed selection', () => {
      renderPlot({
        selection: {
          startMicros: START * 1000,
          endMicros: (START + 60_000) * 1000,
          minDurationMicros: 0,
          maxDurationMicros: 3000,
        },
      });
      expect(screen.getByLabelText('Selected window')).toBeInTheDocument();
    });

    it('offers to clear a committed selection', () => {
      const onSelect = jest.fn();
      render(
        <TracesHeatmap
          data={data()}
          onSelectionChange={onSelect}
          selection={{
            startMicros: START * 1000,
            endMicros: (START + 60_000) * 1000,
            minDurationMicros: 0,
            maxDurationMicros: 3000,
          }}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('has no clear button without a selection', () => {
      render(<TracesHeatmap data={data()} onSelectionChange={jest.fn()} />);
      expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
    });
  });
});

describe('TracesHeatmap duration axis', () => {
  // Sixteen bands means sixteen labels stacked in ~120px, which is a wall of
  // text nobody reads. Five labelled positions let the bands speak instead.
  const manyBands = () =>
    data({
      yEdgesNs: Array.from({ length: 15 }, (_, i) => 1_000 * 10 ** (i / 2)),
      cells: [{ xi: 0, yi: 3, count: 1, errors: 0 }],
    });

  it('labels five positions, not one per band', () => {
    const { container } = render(<TracesHeatmap data={manyBands()} />);
    expect(container.querySelectorAll('[data-testid="duration-tick"]')).toHaveLength(5);
  });

  it('runs from the fastest at the bottom to the slowest at the top', () => {
    // Ticks are positioned, not stacked, so the check is where each one sits.
    const { container } = render(<TracesHeatmap data={manyBands()} />);
    const ticks = [...container.querySelectorAll<HTMLElement>('[data-testid="duration-tick"]')];
    const placed = ticks.map((el) => ({
      micros: Number(el.getAttribute('data-micros')),
      // The end labels are pinned inside the plot rather than centred.
      bottom: el.style.top === '0px' ? 100 : el.style.bottom === '0px' ? 0 : parseFloat(el.style.bottom),
    }));
    const slowest = placed.reduce((a, b) => (b.micros > a.micros ? b : a));
    const fastest = placed.reduce((a, b) => (b.micros < a.micros ? b : a));
    expect(slowest.bottom).toBeGreaterThan(fastest.bottom);
    expect(fastest.bottom).toBe(0);
  });
});
