import {
  CoreApp,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  FieldType,
  LiveChannelScope,
  LoadingState,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
} from '@grafana/data';
import { DataSourceWithBackend, getGrafanaLiveSrv, getTemplateSrv } from '@grafana/runtime';
import { cloneDeep } from 'lodash';
import { merge, Observable } from 'rxjs';
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

    // Live tail is logs-only — search/traceId/stats queries have no "tail"
    // semantic. The /select/logsql/tail endpoint additionally rejects pipes
    // (`| stats`, `| sort`, ...) with a 400; the backend's RunStream handles
    // that case by emitting an error notice and returning nil so Grafana
    // doesn't retry forever.
    if (request.liveStreaming && targets.some((q) => q.queryType === 'logsql-logs')) {
      return this.runLiveQueryThroughBackend({ ...request, targets });
    }

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

  // runLiveQueryThroughBackend opens a Grafana Live channel per logs target.
  // The backend's StreamHandler is wired to the channel path
  // `${requestId}/${refId}` and writes one frame per /select/logsql/tail line.
  // Non-logs targets in the same request are dropped intentionally — Explore's
  // live mode is logs-only on the UI side.
  private runLiveQueryThroughBackend(
    request: DataQueryRequest<VictoriaTracesQuery>
  ): Observable<DataQueryResponse> {
    const uid = this.uid;
    const observables = request.targets
      .filter((q) => q.queryType === 'logsql-logs' && !q.hide)
      .map((query) => {
        return getGrafanaLiveSrv()
          .getDataStream({
            addr: {
              scope: LiveChannelScope.DataSource,
              stream: uid,
              path: `${request.requestId}/${query.refId}`,
              data: { ...query },
            },
          })
          .pipe(
            map((response) => ({
              data: response.data ?? [],
              key: `victoriatraces-datasource-${request.requestId}-${query.refId}`,
              state: LoadingState.Streaming,
            }))
          );
      });
    return merge(...observables);
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

// TAIL_DISALLOWED_PIPES are the LogsQL pipe names rejected by
// /select/logsql/tail per
// https://docs.victoriametrics.com/victorialogs/querying/#live-tailing —
// aggregations, reordering, and pagination cannot be applied to an
// unbounded stream. Other pipes (`fields`, `filter`, `extract`, ...) work.
const TAIL_DISALLOWED_PIPES = ['stats', 'uniq', 'top', 'sort', 'limit', 'offset'] as const;

// isTailableExpr returns true if a LogsQL expression is valid for live
// tailing. We scan for unquoted `| <name>` segments and reject if any name
// matches one of the disallowed pipes. Quoted strings (single, double,
// backtick) are skipped so a literal pipe inside a value can't trigger a
// false positive.
export function isTailableExpr(expr: string | undefined): boolean {
  if (!expr) {
    return false;
  }
  // Strip quoted regions, then look for `| stats`, `| sort`, etc. with
  // word boundaries so substrings like `tops` don't match `top`.
  let stripped = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '\\' && (inSingle || inDouble || inBacktick)) {
      i++;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      stripped += ch;
    }
  }
  const badPipe = new RegExp(`\\|\\s*(${TAIL_DISALLOWED_PIPES.join('|')})\\b`, 'i');
  return !badPipe.test(stripped);
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
