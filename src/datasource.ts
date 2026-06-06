import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  FieldType,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
} from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { cloneDeep } from 'lodash';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { extractLogsQLFilter, getLogsVolumeStep, queryLogsVolume } from './logsVolume';
import { transformResponse } from './transformers/transform';
import { DerivedFieldConfig, NodeGraphOptions, VictoriaTracesOptions, VictoriaTracesQuery } from './types';
import { VariableSupport } from './variableQuery/VariableSupport';

const META_TTL_MS = 60_000;

interface CacheEntry<T> {
  ts: number;
  promise: Promise<T>;
}

export class DataSource extends DataSourceWithBackend<VictoriaTracesQuery, VictoriaTracesOptions> {
  nodeGraph: NodeGraphOptions;
  derivedFields: DerivedFieldConfig[];

  private servicesCache?: CacheEntry<string[]>;
  private operationsCache = new Map<string, CacheEntry<string[]>>();
  private fieldNamesCache = new Map<string, CacheEntry<string[]>>();
  private fieldValuesCache = new Map<string, CacheEntry<string[]>>();

  constructor(instanceSettings: DataSourceInstanceSettings<VictoriaTracesOptions>) {
    super(instanceSettings);
    this.nodeGraph = instanceSettings.jsonData.nodeGraph ?? { enabled: true };
    this.derivedFields = instanceSettings.jsonData.derivedFields ?? [];
    this.variables = new VariableSupport(this);
  }

  private cached<T>(
    entry: CacheEntry<T> | undefined,
    fetcher: () => Promise<T>,
    store: (e: CacheEntry<T> | undefined) => void
  ): Promise<T> {
    if (entry && Date.now() - entry.ts < META_TTL_MS) {
      return entry.promise;
    }
    const next: CacheEntry<T> = { ts: Date.now(), promise: fetcher() };
    next.promise.catch(() => store(undefined));
    store(next);
    return next.promise;
  }

  // $__interval / $__interval_ms / $__range are intentionally not expanded here.
  // The Go backend recomputes them from the time range and max data points so
  // the values match what the upstream LogsQL endpoints expect.
  applyTemplateVariables(query: VictoriaTracesQuery, scopedVars: ScopedVars): VictoriaTracesQuery {
    const srv = getTemplateSrv();
    const { __interval, __interval_ms, __range, __range_s, __range_ms, ...rest } = scopedVars ?? {};
    return {
      ...query,
      traceId: srv.replace(query.traceId ?? '', rest),
      serviceName: srv.replace(query.serviceName ?? '', rest),
      operationName: srv.replace(query.operationName ?? '', rest),
      tags: srv.replace(query.tags ?? '', rest),
      expr: srv.replace(query.expr ?? '', rest),
      legendFormat: srv.replace(query.legendFormat ?? '', rest),
    };
  }

  filterQuery(query: VictoriaTracesQuery): boolean {
    if (query.hide) {
      return false;
    }
    switch (query.queryType) {
      case 'search':
        return Boolean(query.serviceName && query.serviceName.trim());
      case 'traceId':
        return Boolean(query.traceId && query.traceId.trim());
      case 'logsql':
      case 'logsql-instant':
      case 'logsql-logs':
      case 'logsql-hits':
        return Boolean(query.expr && query.expr.trim());
      default:
        return true;
    }
  }

  query(request: DataQueryRequest<VictoriaTracesQuery>): Observable<DataQueryResponse> {
    const timezoneOffset = calcTimezoneOffset(request.timezone, request.range.from.utcOffset());

    // logsql-logs uses /select/logsql/query which expects offset as integer seconds,
    // not a duration string — so timezoneOffset is only injected on endpoints that accept it.
    const targets = request.targets.map((q) => {
      if (
        q.queryType === 'logsql' ||
        q.queryType === 'logsql-instant' ||
        q.queryType === 'logsql-hits'
      ) {
        return { ...q, timezoneOffset };
      }
      return q;
    });

    const derivedFields = this.derivedFields;
    const nodeGraphEnabled = this.nodeGraph.enabled;
    const uid = this.uid;
    const name = this.name;

    return super.query({ ...request, targets }).pipe(
      map((response: DataQueryResponse) => {
        const filtered = {
          ...response,
          data: response.data.filter((frame: any) =>
            nodeGraphEnabled || (frame.name !== 'nodes' && frame.name !== 'edges')
          ),
        };

        for (const frame of filtered.data as any[]) {
          if (frame.name !== 'trace_search') {
            continue;
          }
          const traceIDField = frame.fields?.find(
            (f: { name: string; type: FieldType }) =>
              f.name === 'traceID' && f.type === FieldType.string
          );
          if (traceIDField) {
            traceIDField.config = {
              ...traceIDField.config,
              links: [
                {
                  title: '${__value.raw}',
                  url: '',
                  internal: {
                    query: { queryType: 'traceId', traceId: '${__value.raw}' },
                    datasourceUid: uid,
                    datasourceName: name,
                  },
                },
              ],
            };
          }
        }

        return transformResponse(filtered, { ...request, targets }, derivedFields, { uid, name });
      })
    );
  }

  getDefaultQuery(app: CoreApp): Partial<VictoriaTracesQuery> {
    return {
      queryType: app === CoreApp.Explore ? 'search' : 'traceId',
      limit: 20,
    };
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
  }

  getSupplementaryQuery(
    options: SupplementaryQueryOptions,
    query: VictoriaTracesQuery
  ): VictoriaTracesQuery | undefined {
    if (options.type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    if (query.queryType !== 'logsql-logs' || query.hide) {
      return undefined;
    }
    return {
      ...query,
      queryType: 'logsql-hits',
      expr: extractLogsQLFilter(query.expr ?? '*'),
      fields: ['level'],
      refId: `log-volume-${query.refId}`,
    };
  }

  getSupplementaryRequest(
    type: SupplementaryQueryType,
    request: DataQueryRequest<VictoriaTracesQuery>
  ): DataQueryRequest<VictoriaTracesQuery> | undefined {
    if (type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }

    const logsVolumeRequest = cloneDeep(request);

    const step = getLogsVolumeStep(
      request.range.from.valueOf(),
      request.range.to.valueOf()
    );

    const targets = logsVolumeRequest.targets
      .map((q) => this.getSupplementaryQuery({ type }, q))
      .filter((q): q is VictoriaTracesQuery => q !== undefined)
      .map((q) => ({ ...q, step }));

    if (!targets.length) {
      return undefined;
    }

    return { ...logsVolumeRequest, targets };
  }

  getDataProvider(
    type: SupplementaryQueryType,
    request: DataQueryRequest<VictoriaTracesQuery>
  ): Observable<DataQueryResponse> | undefined {
    if (type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    const volumeRequest = this.getSupplementaryRequest(type, request);
    if (!volumeRequest) {
      return undefined;
    }
    return queryLogsVolume(this, volumeRequest);
  }

  async getServices(): Promise<string[]> {
    return this.cached(
      this.servicesCache,
      () => this.getResource('services'),
      (e) => { this.servicesCache = e; }
    );
  }

  async getOperations(service: string): Promise<string[]> {
    return this.cached(
      this.operationsCache.get(service),
      () => this.getResource(`operations?service=${encodeURIComponent(service)}`),
      (e) => { e ? this.operationsCache.set(service, e) : this.operationsCache.delete(service); }
    );
  }

  async getFieldNames(service?: string, query?: string, limit?: number): Promise<string[]> {
    const params = new URLSearchParams();
    if (service) {
      params.set('service', service);
    }
    if (query) {
      params.set('query', query);
    }
    if (limit && limit > 0) {
      params.set('limit', String(limit));
    }
    const qs = params.toString();
    const key = `${service ?? ''}|${query ?? ''}|${limit ?? ''}`;
    return this.cached(
      this.fieldNamesCache.get(key),
      () => this.getResource(`field_names${qs ? '?' + qs : ''}`),
      (e) => { e ? this.fieldNamesCache.set(key, e) : this.fieldNamesCache.delete(key); }
    );
  }

  async getFieldValues(field: string, limit = 100, service?: string, query?: string): Promise<string[]> {
    const params = new URLSearchParams();
    params.set('field', field);
    if (limit > 0) {
      params.set('limit', String(limit));
    }
    if (service) {
      params.set('service', service);
    }
    if (query) {
      params.set('query', query);
    }
    const key = `${field}|${limit}|${service ?? ''}|${query ?? ''}`;
    return this.cached(
      this.fieldValuesCache.get(key),
      () => this.getResource(`field_values?${params.toString()}`),
      (e) => { e ? this.fieldValuesCache.set(key, e) : this.fieldValuesCache.delete(key); }
    );
  }
}

function calcTimezoneOffset(timezone: string, utcOffsetMinutes: number): string | undefined {
  let totalMinutes = utcOffsetMinutes;
  if (timezone === 'browser') {
    totalMinutes = new Date().getTimezoneOffset() * -1;
  }
  if (totalMinutes === 0) {
    return undefined;
  }
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m > 0 ? `${sign}${h}h${m}m` : `${sign}${h}h`;
}
