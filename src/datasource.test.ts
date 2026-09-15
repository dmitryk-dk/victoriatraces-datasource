import { DataSourceInstanceSettings } from '@grafana/data';
import { DataSource } from './datasource';
import { VictoriaTracesOptions, VictoriaTracesQuery } from './types';

// Mock @grafana/runtime so tests don't need a running Grafana backend.
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getTemplateSrv: () => ({
    replace: (str: string) => str.replace('$service', 'frontend'),
  }),
  getBackendSrv: () => ({}),
}));

function makeDatasource() {
  const settings = {
    id: 1,
    uid: 'test',
    name: 'VictoriaTraces',
    type: 'victoriametrics-traces-datasource',
    url: 'http://localhost:10428',
    jsonData: {},
    access: 'proxy',
  } as DataSourceInstanceSettings<VictoriaTracesOptions>;

  return new DataSource(settings);
}

describe('DataSource', () => {
  it('instantiates without error', () => {
    expect(() => makeDatasource()).not.toThrow();
  });

  describe('applyTemplateVariables', () => {
    it('replaces template variables in string fields', () => {
      const ds = makeDatasource();
      const query: VictoriaTracesQuery = {
        refId: 'A',
        queryType: 'search',
        serviceName: '$service',
        operationName: 'GET /api',
        traceId: '',
        tags: '',
      };

      const result = ds.applyTemplateVariables(query, {});
      expect(result.serviceName).toBe('frontend');
      expect(result.operationName).toBe('GET /api');
    });

    it('handles undefined optional fields gracefully', () => {
      const ds = makeDatasource();
      const query: VictoriaTracesQuery = {
        refId: 'A',
        queryType: 'search',
      };

      expect(() => ds.applyTemplateVariables(query, {})).not.toThrow();
    });
  });
});

describe('getFieldNames', () => {
  it('returns plain names, whatever shape the backend sends', async () => {
    // The resource carries hit counts for the filter picker; every other
    // caller — tag input, variable queries — renders these as strings.
    const ds = makeDatasource();
    jest
      .spyOn(ds, 'getResource')
      .mockResolvedValue([
        { value: 'span_attr:http.route', hits: 12 },
        { value: 'resource_attr:host.name', hits: 3 },
      ]);

    await expect(ds.getFieldNames()).resolves.toEqual([
      'span_attr:http.route',
      'resource_attr:host.name',
    ]);
  });

  it('still accepts a bare list of names', async () => {
    const ds = makeDatasource();
    jest.spyOn(ds, 'getResource').mockResolvedValue(['span_attr:http.route']);

    await expect(ds.getFieldNames()).resolves.toEqual(['span_attr:http.route']);
  });
});

describe('metadata lookups are time-scoped', () => {
  it('sends the range with field values', async () => {
    // Unscoped, this scans the whole retention window: 25s against a modest
    // dataset, where the same call inside an hour takes 0.2s.
    const ds = makeDatasource();
    const getResource = jest.spyOn(ds, 'getResource').mockResolvedValue([]);

    await ds.getFieldValues('span_attr:http.route', 100, undefined, undefined, {
      start: '2026-09-11T12:00:00Z',
      end: '2026-09-11T13:00:00Z',
    });

    const url = getResource.mock.calls[0][0] as string;
    expect(url).toContain('start=2026-09-11T12%3A00%3A00Z');
    expect(url).toContain('end=2026-09-11T13%3A00%3A00Z');
  });

  it('sends the range with field names', async () => {
    const ds = makeDatasource();
    const getResource = jest.spyOn(ds, 'getResource').mockResolvedValue([]);

    await ds.getFieldNames(undefined, undefined, undefined, {
      start: '2026-09-11T12:00:00Z',
      end: '2026-09-11T13:00:00Z',
    });

    expect(getResource.mock.calls[0][0]).toContain('start=2026-09-11T12%3A00%3A00Z');
  });

  it('caches per range, so a new range is not served the old answer', async () => {
    const ds = makeDatasource();
    jest
      .spyOn(ds, 'getResource')
      .mockResolvedValueOnce(['a'])
      .mockResolvedValueOnce(['b']);

    const first = await ds.getFieldValues('f', 100, undefined, undefined, {
      start: '2026-09-11T12:00:00Z',
      end: '2026-09-11T13:00:00Z',
    });
    const second = await ds.getFieldValues('f', 100, undefined, undefined, {
      start: '2026-09-10T12:00:00Z',
      end: '2026-09-10T13:00:00Z',
    });

    expect(first).toEqual(['a']);
    expect(second).toEqual(['b']);
  });

  it('still works with no range at all', async () => {
    const ds = makeDatasource();
    const getResource = jest.spyOn(ds, 'getResource').mockResolvedValue([]);

    await ds.getFieldValues('f');
    expect(getResource.mock.calls[0][0]).not.toContain('start=');
  });
});

