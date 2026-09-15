import {
  EMPTY_SPAN_FILTER,
  filterSpans,
  isSpanFilterActive,
  spanService,
  traceServices,
  type SpanFilterable,
} from './spanFilter';

const TRACE = 't';

function span(
  spanID: string,
  operationName: string,
  processID: string,
  parent?: string,
  tags: Array<{ key: string; value: unknown }> = []
): SpanFilterable {
  return {
    spanID,
    operationName,
    processID,
    tags,
    references: parent ? [{ refType: 'CHILD_OF', spanID: parent, traceID: TRACE }] : [],
  };
}

const processes = {
  p1: { serviceName: 'frontend' },
  p2: { serviceName: 'checkout' },
};

const spans = [
  span('root', 'GET /', 'p1'),
  span('cart', 'load cart', 'p2', 'root'),
  span('charge', 'charge card', 'p2', 'cart', [{ key: 'error', value: 'true' }]),
  span('log', 'write log', 'p1', 'root'),
];

describe('isSpanFilterActive', () => {
  it('is inactive when nothing is set', () => {
    expect(isSpanFilterActive(EMPTY_SPAN_FILTER)).toBe(false);
    expect(isSpanFilterActive({ text: '   ', services: [], errorsOnly: false })).toBe(false);
  });

  it('is active on any one criterion', () => {
    expect(isSpanFilterActive({ ...EMPTY_SPAN_FILTER, text: 'cart' })).toBe(true);
    expect(isSpanFilterActive({ ...EMPTY_SPAN_FILTER, services: ['checkout'] })).toBe(true);
    expect(isSpanFilterActive({ ...EMPTY_SPAN_FILTER, errorsOnly: true })).toBe(true);
  });
});

describe('spanService', () => {
  it('names the service of a span', () => {
    expect(spanService(spans[1], processes)).toBe('checkout');
  });

  it('falls back to the process id when the process is unknown', () => {
    expect(spanService(span('x', 'op', 'missing'), processes)).toBe('missing');
  });
});

describe('traceServices', () => {
  it('lists each service once, in the order first seen', () => {
    expect(traceServices(spans, processes)).toEqual(['frontend', 'checkout']);
  });
});

describe('filterSpans', () => {
  it('matches everything when the filter is empty', () => {
    const { matched } = filterSpans(spans, processes, EMPTY_SPAN_FILTER);
    expect(matched.size).toBe(4);
  });

  it('matches the operation name case-insensitively', () => {
    const { matched } = filterSpans(spans, processes, { ...EMPTY_SPAN_FILTER, text: 'CART' });
    expect([...matched]).toEqual(['cart']);
  });

  it('keeps every ancestor of a match visible', () => {
    // A span read against the parents that led to it is far easier to place
    // than one shown on its own.
    const { visible } = filterSpans(spans, processes, { ...EMPTY_SPAN_FILTER, text: 'charge' });
    expect([...visible].sort()).toEqual(['cart', 'charge', 'root']);
  });

  it('does not make the siblings of a match visible', () => {
    const { visible } = filterSpans(spans, processes, { ...EMPTY_SPAN_FILTER, text: 'charge' });
    expect(visible.has('log')).toBe(false);
  });

  it('filters by service', () => {
    const { matched } = filterSpans(spans, processes, {
      ...EMPTY_SPAN_FILTER,
      services: ['checkout'],
    });
    expect([...matched].sort()).toEqual(['cart', 'charge']);
  });

  it('filters to errored spans, including the OTel status code', () => {
    const withOtel = [...spans, span('otel', 'flush', 'p1', 'root', [{ key: 'otel.status_code', value: '2' }])];
    const { matched } = filterSpans(withOtel, processes, { ...EMPTY_SPAN_FILTER, errorsOnly: true });
    expect([...matched].sort()).toEqual(['charge', 'otel']);
  });

  it('requires every active criterion to hold', () => {
    const { matched } = filterSpans(spans, processes, {
      text: 'cart',
      services: ['frontend'],
      errorsOnly: false,
    });
    expect(matched.size).toBe(0);
  });

  it('survives a span whose parent is missing', () => {
    const orphan = [span('child', 'op', 'p1', 'gone')];
    const { visible } = filterSpans(orphan, processes, { ...EMPTY_SPAN_FILTER, text: 'op' });
    expect([...visible]).toEqual(['child']);
  });

  it('terminates on a cyclic parent reference', () => {
    const cycle = [span('a', 'op a', 'p1', 'b'), span('b', 'op b', 'p1', 'a')];
    const { visible } = filterSpans(cycle, processes, { ...EMPTY_SPAN_FILTER, text: 'op a' });
    expect([...visible].sort()).toEqual(['a', 'b']);
  });
});
