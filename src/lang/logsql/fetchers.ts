import { getDataSourceSrv } from '@grafana/runtime';

import type { MetadataRange } from '../../datasource';

/** What the editor can ask the datasource while you type. */
export interface LogsqlFetchers {
  fields(): Promise<string[]>;
  values(field: string): Promise<string[]>;
}

/** Enough values to choose from without turning the list into a scroll. */
const VALUE_LIMIT = 100;

interface MetadataSource {
  getFieldNames(
    service?: string,
    query?: string,
    limit?: number,
    range?: MetadataRange
  ): Promise<string[]>;
  getFieldValues(
    field: string,
    limit?: number,
    service?: string,
    query?: string,
    range?: MetadataRange
  ): Promise<string[]>;
}

/**
 * Field and value suggestions drawn from the data itself.
 *
 * Both calls are scoped to the dashboard's range: unscoped they take tens of
 * seconds against a busy store, which is far too slow to answer a keystroke.
 * The datasource caches them, so repeated keystrokes cost one request.
 */
export function createLogsqlFetchers(
  uid: string | undefined,
  range?: MetadataRange
): LogsqlFetchers | undefined {
  if (!uid) {
    return undefined;
  }

  const source = async (): Promise<MetadataSource> =>
    (await getDataSourceSrv().get(uid)) as unknown as MetadataSource;

  return {
    fields: async () => (await source()).getFieldNames(undefined, undefined, undefined, range),
    values: async (field: string) =>
      (await source()).getFieldValues(field, VALUE_LIMIT, undefined, undefined, range),
  };
}
