import React from 'react';
import { render, screen } from '@testing-library/react';

import type { TraceSpan } from '../types';
import { SpanDuration } from './SpanDuration';

function span(startTime: number, duration: number): TraceSpan {
  return {
    traceID: 't',
    spanID: 's',
    operationName: 'op',
    processID: 'p',
    startTime,
    duration,
    references: [],
    tags: [],
    logs: [],
  };
}

const CRITICAL_TITLE = /On the critical path/;

describe('SpanDuration critical path overlay', () => {
  it('draws nothing when the span is not on the critical path', () => {
    render(<SpanDuration span={span(0, 100)} minMs={0} maxMs={100} />);
    expect(screen.queryByTitle(CRITICAL_TITLE)).not.toBeInTheDocument();
  });

  it('draws a band per segment', () => {
    render(
      <SpanDuration
        span={span(0, 100)}
        minMs={0}
        maxMs={100}
        criticalSegments={[
          { start: 0, end: 20 },
          { start: 60, end: 100 },
        ]}
      />
    );
    expect(screen.getAllByTitle(CRITICAL_TITLE)).toHaveLength(2);
  });

  it('positions a band relative to the span, not the whole timeline', () => {
    // Span occupies 100–200 of a 0–400 trace; the segment covers its second half.
    render(
      <SpanDuration
        span={span(100, 100)}
        minMs={0}
        maxMs={400}
        criticalSegments={[{ start: 150, end: 200 }]}
      />
    );
    const band = screen.getByTitle(CRITICAL_TITLE);
    expect(band).toHaveStyle({ left: '50%', width: '50%' });
  });

  it('clips a segment that overruns the span', () => {
    // Malformed data: the segment starts before and ends after the span.
    render(
      <SpanDuration
        span={span(100, 100)}
        minMs={0}
        maxMs={400}
        criticalSegments={[{ start: 0, end: 999 }]}
      />
    );
    expect(screen.getByTitle(CRITICAL_TITLE)).toHaveStyle({ left: '0%', width: '100%' });
  });

  it('drops empty segments', () => {
    render(
      <SpanDuration span={span(0, 100)} minMs={0} maxMs={100} criticalSegments={[{ start: 50, end: 50 }]} />
    );
    expect(screen.queryByTitle(CRITICAL_TITLE)).not.toBeInTheDocument();
  });

  it('draws nothing for a zero-duration span', () => {
    render(
      <SpanDuration span={span(10, 0)} minMs={0} maxMs={100} criticalSegments={[{ start: 10, end: 10 }]} />
    );
    expect(screen.queryByTitle(CRITICAL_TITLE)).not.toBeInTheDocument();
  });
});

describe('SpanDuration bar width', () => {
  it('keeps a near-zero span visible', () => {
    // A span far shorter than the trace still needs a sliver wide enough to
    // see and to hover, which the 0.5% floor gives it.
    render(<SpanDuration span={span(0, 1)} minMs={0} maxMs={100_000} />);

    const bar = screen.getByTitle(/start \+/);
    expect(parseFloat(bar.style.width)).toBeCloseTo(0.5, 5);
  });

  it('leaves a normal span at its true width', () => {
    render(<SpanDuration span={span(0, 25)} minMs={0} maxMs={100} />);

    const bar = screen.getByTitle(/start \+/);
    expect(parseFloat(bar.style.width)).toBeCloseTo(25, 5);
  });
});
