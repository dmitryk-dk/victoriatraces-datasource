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
    const promise = this.execute(interpolated);
    return from(promise).pipe(
      map((values) => ({
        data: values,
      }))
    );
  }

  private async execute(query: VariableQuery): Promise<MetricFindValue[]> {
    if (!query.type || query.type === 'fieldName') {
      const names = await this.datasource.getFieldNames(undefined, query.query, query.limit);
      return names.map((n) => ({ text: n }));
    }

    if (query.type === 'fieldValue') {
      const field = query.field ?? '';
      if (!field) {
        return [];
      }
      const values = await this.datasource.getFieldValues(field, query.limit ?? 100, undefined, query.query);
      return values.map((v) => ({ text: v }));
    }

    return [];
  }
}