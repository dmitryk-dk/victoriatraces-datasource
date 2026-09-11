import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { TraceSpanTree } from './TraceSpanTree';
import type { Trace, TraceSpan } from '../types';

const TRACE_ID = 't';

// The waterfall is virtualized, and the virtualizer sizes its viewport from
// offsetHeight, which jsdom pins at 0 — leaving every row unrendered. Report a
// screenful so the rows under test actually mount.
const VIEWPORT_PX = 800;

beforeAll(() => {
  // jsdom has no scrollTo, so a programmatic scroll would be a no-op and the
  // virtualizer would never learn its offset changed.
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number) {
    const top = typeof options === 'number' ? options : (options?.top ?? 0);
    Object.defineProperty(this, 'scrollTop', { configurable: true, value: top, writable: true });
    this.dispatchEvent(new Event('scroll'));
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => VIEWPORT_PX,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 1024,
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
});

function span(
  spanID: string,
  tags: TraceSpan['tags'],
  parent?: string,
  overrides: Partial<TraceSpan> = {}
): TraceSpan {
  return {
    traceID: TRACE_ID,
    spanID,
    operationName: spanID,
    processID: 'p',
    startTime: 0,
    duration: 10,
    tags,
    logs: [],
    references: parent ? [{ refType: 'CHILD_OF', spanID: parent, traceID: TRACE_ID }] : [],
    ...overrides,
  };
}

function trace(spans: TraceSpan[], processes?: Trace['processes']): Trace {
  return {
    traceID: TRACE_ID,
    spans,
    processes: processes ?? { p: { serviceName: 'frontend', tags: [] } },
  };
}

describe('TraceSpanTree error detection', () => {
  it('marks a span whose only error signal is the OTel status code', () => {
    // The table view already counts this span as an error; the waterfall has
    // to agree, or the same trace reads differently in the two views.
    render(<TraceSpanTree trace={trace([span('root', [{ key: 'otel.status_code', value: '2' }])])} />);

    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('counts OTel-status errors in the header', () => {
    render(
      <TraceSpanTree
        trace={trace([
          span('root', [{ key: 'otel.status_code', value: '2' }]),
          span('child', [{ key: 'error', value: 'true' }], 'root'),
          span('ok', [], 'root'),
        ])}
      />
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('leaves a healthy span unmarked', () => {
    render(<TraceSpanTree trace={trace([span('root', [{ key: 'otel.status_code', value: '1' }])])} />);

    expect(screen.queryByText('error')).not.toBeInTheDocument();
  });
});

describe('TraceSpanTree span filter', () => {
  const spans = [
    span('root', []),
    span('cart', [], 'root'),
    span('charge', [{ key: 'error', value: 'true' }], 'cart'),
    span('log', [], 'root'),
  ];

  function typeFilter(text: string) {
    fireEvent.change(screen.getByPlaceholderText('Filter spans…'), { target: { value: text } });
  }

  it('narrows the tree to matching spans', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    typeFilter('charge');

    expect(screen.getByText('charge')).toBeInTheDocument();
    expect(screen.queryByText('log')).not.toBeInTheDocument();
  });

  it('keeps the ancestors of a match, so it holds its place in the tree', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    typeFilter('charge');

    expect(screen.getByText('root')).toBeInTheDocument();
    expect(screen.getByText('cart')).toBeInTheDocument();
  });

  it('says how many spans matched', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    typeFilter('c');
    // "cart" and "charge".
    expect(screen.getByText('2 of 4 spans')).toBeInTheDocument();
  });

  it('filters to errored spans on its own', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    fireEvent.click(screen.getByLabelText('Errors only'));

    expect(screen.getByText('charge')).toBeInTheDocument();
    expect(screen.queryByText('log')).not.toBeInTheDocument();
  });

  it('restores the whole tree when the filter is cleared', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    typeFilter('charge');
    typeFilter('');

    expect(screen.getByText('log')).toBeInTheDocument();
  });

  it('says when nothing matched', () => {
    render(<TraceSpanTree trace={trace(spans)} />);
    typeFilter('nothing-here');
    expect(screen.getByText('No spans match this filter.')).toBeInTheDocument();
  });
});

describe('TraceSpanTree expansion', () => {
  it('expands the spans of a trace that arrives after mount', () => {
    // The panel reuses one tree instance; expansion state keyed to the old
    // trace leaves the new one collapsed under its roots.
    const first = [span('root', []), span('child', [], 'root')];
    const { rerender } = render(<TraceSpanTree trace={trace(first)} />);
    expect(screen.getByText('child')).toBeInTheDocument();

    const second = [span('root2', []), span('child2', [], 'root2')];
    rerender(<TraceSpanTree trace={trace(second)} />);

    expect(screen.getByText('child2')).toBeInTheDocument();
  });

  it('keeps a collapsed branch collapsed while the same trace is on screen', () => {
    const spans = [span('root', []), span('child', [], 'root')];
    const { rerender } = render(<TraceSpanTree trace={trace(spans)} />);

    fireEvent.click(screen.getByLabelText('Collapse root'));
    expect(screen.queryByText('child')).not.toBeInTheDocument();

    rerender(<TraceSpanTree trace={trace(spans)} />);
    expect(screen.queryByText('child')).not.toBeInTheDocument();
  });
});

describe('TraceSpanTree critical span', () => {
  it('marks the span that owns most of the critical path', () => {
    const spans = [
      span('root', [], undefined, { startTime: 0, duration: 100 }),
      span('slow', [], 'root', { startTime: 0, duration: 90 }),
    ];
    render(<TraceSpanTree trace={trace(spans)} />);

    expect(screen.getByTitle('Owns most of the critical path')).toBeInTheDocument();
  });
});

describe('TraceSpanTree virtualization', () => {
  it('mounts a screenful of rows, not the whole trace', () => {
    // A trace with thousands of spans made the panel unusable when every row
    // was in the DOM at once.
    const spans = [span('root', [])];
    for (let i = 0; i < 1000; i++) {
      spans.push(span(`child-${i}`, [], 'root'));
    }

    const { container } = render(<TraceSpanTree trace={trace(spans)} />);

    const rendered = container.querySelectorAll('[data-index]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(200);
  });

  it('still reports the full span count in the header', () => {
    const spans = [span('root', [])];
    for (let i = 0; i < 1000; i++) {
      spans.push(span(`child-${i}`, [], 'root'));
    }
    render(<TraceSpanTree trace={trace(spans)} />);
    expect(screen.getByText('1001')).toBeInTheDocument();
  });
});
