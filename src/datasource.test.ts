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
    type: 'victoriatraces-datasource',
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
