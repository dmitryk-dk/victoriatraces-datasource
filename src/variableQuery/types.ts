import { DataQuery } from '@grafana/data';

export type VariableQueryType = 'fieldValue' | 'fieldName';

export interface VariableQuery extends DataQuery {
  type: VariableQueryType;
  field?: string;
  query?: string;
  limit?: number;
}

export const defaultVariableQuery: Partial<VariableQuery> = {
  type: 'fieldName',
  limit: 100,
};
