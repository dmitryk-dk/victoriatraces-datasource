import { buildTraceListQuery, logsqlQuoteValue, parseDurationToNs, traceContainsSubquery } from './logsql';
import type { TraceFilter } from './types';

describe('logsqlQuoteValue', () => {
  it('quotes plain values', () => {
    expect(logsqlQuoteValue('checkout')).toBe('"checkout"');
  });

  it('escapes quotes and backslashes so values cannot inject syntax', () => {
    expect(logsqlQuoteValue('a"b')).toBe('"a\\"b"');
    expect(logsqlQuoteValue('a\\b')).toBe('"a\\\\b"');
  });
});

describe('parseDurationToNs', () => {
  it.each([
    ['1ns', 1],
    ['1us', 1e3],
    ['1µs', 1e3],
    ['1ms', 1e6],
    ['1s', 1e9],
    ['1m', 6e10],
    ['1h', 3.6e12],
  ])('parses %s', (input, expected) => {
    expect(parseDurationToNs(input)).toBe(expected);
  });

  it('accepts fractions and surrounding space', () => {
    expect(parseDurationToNs('1.5s')).toBe(1.5e9);
    expect(parseDurationToNs(' 250 ms ')).toBe(2.5e8);
  });

  it('rejects malformed input', () => {
    expect(parseDurationToNs(undefined)).toBeUndefined();
    expect(parseDurationToNs('')).toBeUndefined();
    expect(parseDurationToNs('fast')).toBeUndefined();
    expect(parseDurationToNs('10')).toBeUndefined();
    expect(parseDurationToNs('10 parsecs')).toBeUndefined();
  });
});

describe('buildTraceListQuery', () => {
  const build = (filters: TraceFilter[], extra = {}) => buildTraceListQuery({ filters, ...extra });

  it('produces empty fragments with no filters', () => {
    expect(build([])).toEqual({ where: '', postFilter: '', matchCond: '', limit: undefined });
  });

  it('combines services and operations into one containment subquery', () => {
    const q = build([{ kind: 'operation', value: 'GET /' }], { services: ['checkout'] });
    expect(q.where).toBe(
      traceContainsSubquery('"resource_attr:service.name":in("checkout") AND name:in("GET /")')
    );
  });

  it('matches a tag bare or under either attribute prefix', () => {
    const q = build([{ kind: 'tag', key: 'http.method', value: 'GET' }]);
    expect(q.where).toContain('"http.method":"GET"');
    expect(q.where).toContain('"span_attr:http.method":"GET"');
    expect(q.where).toContain('"resource_attr:http.method":"GET"');
  });

  it('keeps whole traces when filtering on an errored span', () => {
    // Containment, not a plain condition: the trace's healthy spans must stay.
    expect(build([{ kind: 'error' }]).where).toBe(traceContainsSubquery('status_code:2'));
  });

  it('maps a span type to its attribute probe', () => {
    expect(build([{ kind: 'spanType', value: 'db' }]).where).toBe(
      traceContainsSubquery('"span_attr:db.system":*')
    );
  });

  it('puts span counts and durations in the post-filter, not the where', () => {
    // Both only exist after the per-trace aggregation.
    const q = build([
      { kind: 'spans', min: 3, max: 100 },
      { kind: 'duration', min: '250ms', max: '2s' },
    ]);
    expect(q.where).toBe('');
    expect(q.postFilter).toBe('| filter spans:>=3 spans:<=100 durationNs:>=250000000 durationNs:<=2000000000');
  });

  it('drops duration bounds it cannot parse', () => {
    expect(build([{ kind: 'duration', min: 'soon' }]).postFilter).toBe('');
  });

  it('extracts the limit rather than emitting a condition', () => {
    const q = build([{ kind: 'limit', value: 25 }]);
    expect(q).toEqual({ where: '', postFilter: '', matchCond: '', limit: 25 });
  });

  it('ANDs several span-level filters', () => {
    const q = build([{ kind: 'error' }, { kind: 'spanType', value: 'http' }]);
    expect(q.where.split(' AND trace_id:in(')).toHaveLength(2);
  });

  it('appends a raw query as its own containment clause', () => {
    const q = build([], { rawQuery: '  status_code:2  ' });
    expect(q.where).toBe(traceContainsSubquery('status_code:2'));
  });

  it('ignores a blank raw query', () => {
    expect(build([], { rawQuery: '   ' }).where).toBe('');
  });

  describe('spans mode', () => {
    const buildSpans = (filters: TraceFilter[], extra = {}) =>
      buildTraceListQuery({ filters, entity: 'spans', ...extra });

    it('matches spans directly instead of traces containing them', () => {
      const q = buildSpans([{ kind: 'error' }]);
      expect(q.where).toBe('span_id:* AND status_code:2');
      expect(q.where).not.toContain('trace_id:in(');
    });

    it('filters the span facets without a subquery', () => {
      const q = buildSpans([{ kind: 'operation', value: 'GET /' }], { services: ['checkout'] });
      expect(q.where).toBe(
        'span_id:* AND "resource_attr:service.name":in("checkout") AND name:in("GET /")'
      );
    });

    it('filters a span duration in the where clause, not after an aggregation', () => {
      // There is no per-trace aggregate in spans mode, so durationNs does not exist.
      const q = buildSpans([{ kind: 'duration', min: '250ms', max: '2s' }]);
      expect(q.where).toBe('span_id:* AND duration:>=250000000 AND duration:<=2000000000');
      expect(q.postFilter).toBe('');
    });

    it('ignores the span-count filter, which is a per-trace aggregate', () => {
      const q = buildSpans([{ kind: 'spans', min: 3 }]);
      expect(q.postFilter).toBe('');
      expect(q.where).toBe('');
    });

    it('still honours the limit', () => {
      expect(buildSpans([{ kind: 'limit', value: 25 }]).limit).toBe(25);
    });
  });

  describe('matched-span condition', () => {
    it('reports the bare facet condition for traces mode', () => {
      const q = buildTraceListQuery({
        filters: [{ kind: 'operation', value: 'GET /' }],
        services: ['checkout'],
      });
      // Bare, not wrapped: it identifies the matching span inside the trace.
      expect(q.matchCond).toBe('"resource_attr:service.name":in("checkout") AND name:in("GET /")');
      expect(q.matchCond).not.toContain('trace_id:in(');
    });

    it('is empty when nothing was filtered on', () => {
      expect(buildTraceListQuery({ filters: [] }).matchCond).toBe('');
    });

    it('is empty in spans mode, where the row is already the span', () => {
      const q = buildTraceListQuery({ filters: [], services: ['checkout'], entity: 'spans' });
      expect(q.matchCond).toBe('');
    });
  });

  describe('spans-mode base filter', () => {
    it('leads with a field-bearing filter', () => {
      const q = buildTraceListQuery({ filters: [{ kind: 'error' }], entity: 'spans' });
      expect(q.where).toBe('span_id:* AND status_code:2');
    });

    it('stays empty when there is nothing to filter', () => {
      expect(buildTraceListQuery({ filters: [], entity: 'spans' }).where).toBe('');
    });

    it('bounds a span duration inclusively at both ends', () => {
      const q = buildTraceListQuery({
        filters: [{ kind: 'duration', min: '250ms', max: '2s' }],
        entity: 'spans',
      });
      expect(q.where).toBe('span_id:* AND duration:>=250000000 AND duration:<=2000000000');
    });
  });

  describe('field filters', () => {
    it('wraps a field condition for traces mode', () => {
      const q = build([{ kind: 'field', mode: 'field', field: 'status_code', operator: 'equals', value: '2' }]);
      expect(q.where).toBe(traceContainsSubquery('status_code:="2"'));
    });

    it('applies it directly in spans mode', () => {
      const q = buildTraceListQuery({
        filters: [{ kind: 'field', mode: 'field', field: 'status_code', operator: 'equals', value: '2' }],
        entity: 'spans',
      });
      expect(q.where).toBe('span_id:* AND status_code:="2"');
    });

    it('passes a custom expression through as written', () => {
      const q = build([{ kind: 'field', mode: 'custom', expr: '  status_code:2  ' }]);
      expect(q.where).toBe(traceContainsSubquery('status_code:2'));
    });

    it('adds nothing for the "all" mode', () => {
      expect(build([{ kind: 'field', mode: 'all' }]).where).toBe('');
    });

    it('needs no value for exists', () => {
      const q = build([{ kind: 'field', mode: 'field', field: 'error', operator: 'exists', value: '' }]);
      expect(q.where).toBe(traceContainsSubquery('error:*'));
    });

    it('drops an incomplete filter rather than emitting a broken condition', () => {
      // A value-taking operator with no value, and a filter with no field.
      expect(
        build([{ kind: 'field', mode: 'field', field: 'status_code', operator: 'equals', value: '' }]).where
      ).toBe('');
      expect(
        build([{ kind: 'field', mode: 'field', field: '', operator: 'equals', value: '2' }]).where
      ).toBe('');
      expect(build([{ kind: 'field', mode: 'custom', expr: '   ' }]).where).toBe('');
    });

    it('combines with other filters', () => {
      const q = build([
        { kind: 'error' },
        { kind: 'field', mode: 'field', field: 'name', operator: 'contains', value: 'order' },
      ]);
      expect(q.where).toContain(traceContainsSubquery('status_code:2'));
      expect(q.where).toContain(traceContainsSubquery('name:"order"'));
    });
  });
});
