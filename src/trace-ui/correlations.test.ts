import type { Trace, TraceSpan } from '../panel/types';
import {
  buildAutoMetricsSelector,
  escapeMetricsQLValue,
  resolveSpanField,
  resolveSpanTemplate,
} from './correlations';

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getInstanceSettings: () => ({ type: 'test' }) }),
  locationService: { getSearch: () => new URLSearchParams(), push: jest.fn() },
}));

const span: TraceSpan = {
  traceID: 'trace-1',
  spanID: 'span-1',
  operationName: 'POST /order',
  processID: 'p1',
  startTime: 0,
  duration: 1,
  references: [],
  logs: [],
  tags: [
    { key: 'http.status_code', value: '500' },
    { key: 'empty', value: '' },
  ],
};

const trace: Trace = {
  traceID: 'trace-1',
  spans: [span],
  processes: {
    p1: {
      serviceName: 'checkout',
      tags: [{ key: 'k8s.pod.name', value: 'pod-7' }],
    },
  },
};

describe('resolveSpanField', () => {
  it('prefers a span tag', () => {
    expect(resolveSpanField(trace, span, 'http.status_code')).toBe('500');
  });

  it('falls back to the process resource attributes', () => {
    expect(resolveSpanField(trace, span, 'k8s.pod.name')).toBe('pod-7');
  });

  it.each([
    ['traceId', 'trace-1'],
    ['trace_id', 'trace-1'],
    ['trace.id', 'trace-1'],
    ['spanId', 'span-1'],
    ['operation', 'POST /order'],
    ['service.name', 'checkout'],
  ])('accepts the %s name variant', (field, expected) => {
    expect(resolveSpanField(trace, span, field)).toBe(expected);
  });

  it('treats an empty tag value as absent so the fallbacks still apply', () => {
    expect(resolveSpanField(trace, span, 'empty')).toBe('');
  });

  it('returns empty for an unknown field', () => {
    expect(resolveSpanField(trace, span, 'nope')).toBe('');
  });
});

describe('resolveSpanTemplate', () => {
  it('substitutes every placeholder', () => {
    const out = resolveSpanTemplate(trace, span, 'trace_id:=${__span.traceId} AND svc:=${__span.service}');
    expect(out).toBe('trace_id:=trace-1 AND svc:=checkout');
  });

  it('supports the tags. prefix', () => {
    expect(resolveSpanTemplate(trace, span, '${__span.tags.http.status_code}')).toBe('500');
  });

  it('leaves non-placeholder text alone', () => {
    expect(resolveSpanTemplate(trace, span, 'no placeholders here')).toBe('no placeholders here');
  });
});

describe('escapeMetricsQLValue', () => {
  it('escapes what a MetricsQL label value cannot contain raw', () => {
    expect(escapeMetricsQLValue('a"b\\c\nd\te')).toBe('a\\"b\\\\c\\nd\\te');
  });
});

describe('buildAutoMetricsSelector', () => {
  it('builds a selector from the mappings that resolve', () => {
    const selector = buildAutoMetricsSelector(
      {
        datasourceUid: 'ds',
        labelMappings: [
          { spanField: 'service', metricLabel: 'job' },
          { spanField: 'tags.http.status_code', metricLabel: 'code' },
        ],
      },
      trace,
      span
    );
    expect(selector).toBe('{job="checkout", code="500"}');
  });

  it('drops mappings whose field has no value', () => {
    const selector = buildAutoMetricsSelector(
      {
        datasourceUid: 'ds',
        labelMappings: [
          { spanField: 'service', metricLabel: 'job' },
          { spanField: 'missing', metricLabel: 'nope' },
        ],
      },
      trace,
      span
    );
    expect(selector).toBe('{job="checkout"}');
  });

  it('returns undefined when nothing resolves, so the action can be hidden', () => {
    expect(
      buildAutoMetricsSelector(
        { datasourceUid: 'ds', labelMappings: [{ spanField: 'missing', metricLabel: 'nope' }] },
        trace,
        span
      )
    ).toBeUndefined();
    expect(buildAutoMetricsSelector(undefined, trace, span)).toBeUndefined();
  });
});
