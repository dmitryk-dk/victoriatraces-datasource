import { CustomVariableSupport, DataQueryRequest, DataQueryResponse, MetricFindValue } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

import { DataSource } from '../datasource';
import { VariableQuery } from './types';
import { VariableQueryEditor } from './VariableQueryEditor';

export class VariableSupport extends CustomVariableSupport<DataSource, VariableQuery> {
  private datasource: DataSource;

  constructor(datasource: DataSource) {
    super();
    this.datasource = datasource;
  }

  editor = VariableQueryEditor;

  query(request: DataQueryRequest<VariableQuery>): Observable<DataQueryResponse> {
    const query = request.targets[0];
    const interpolated: VariableQuery = {
      ...query,
      field: getTemplateSrv().replace(query.field ?? '', request.scopedVars),
      query: getTemplateSrv().replace(query.query ?? '', request.scopedVars),
    };
    // Unscoped, these metadata lookups scan the whole retention window and
    // time out on a busy source; the request already carries the range.
    const promise = this.execute(interpolated, {
      start: request.range?.from.toISOString(),
      end: request.range?.to.toISOString(),
    });
    return from(promise).pipe(
      map((values) => ({
        data: values,
      }))
    );
  }

  private async execute(
    query: VariableQuery,
    range: { start?: string; end?: string }
  ): Promise<MetricFindValue[]> {
    if (!query.type || query.type === 'fieldName') {
      const names = await this.datasource.getFieldNames(undefined, query.query, query.limit, range);
      return names.map((n) => ({ text: n }));
    }

    if (query.type === 'fieldValue') {
      const field = query.field ?? '';
      if (!field) {
        return [];
      }
      const values = await this.datasource.getFieldValues(
        field,
        query.limit ?? 100,
        undefined,
        query.query,
        range
      );
      return values.map((v) => ({ text: v }));
    }

    return [];
  }
}
