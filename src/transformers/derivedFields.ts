import { DataFrame, DataLink, Field, FieldType } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

import { DerivedFieldConfig } from '../types';
import { parseLabelsValue } from './processLogsFrame';

/**
 * Adds derived-field columns to a logs data frame.
 * Each derived field extracts a value from the row (by label key or regex on
 * the log line) and attaches a DataLink so Grafana renders it as a button.
 *
 * Mirrors VictoriaLogs' getDerivedFields transformer.
 */
export function applyDerivedFields(frame: DataFrame, configs: DerivedFieldConfig[]): DataFrame {
  if (!configs.length) {
    return frame;
  }

  const lineField = frame.fields.find((f) => f.type === FieldType.string);
  const labelsField = frame.fields.find((f) => f.type === FieldType.other && f.name === 'labels');

  if (!lineField) {
    return frame;
  }

  // Group configs by name so multiple links can share one field column.
  const byName = new Map<string, DerivedFieldConfig[]>();
  for (const cfg of configs) {
    if (!cfg.name) {
      continue;
    }
    const existing = byName.get(cfg.name) ?? [];
    existing.push(cfg);
    byName.set(cfg.name, existing);
  }

  const newFields: Field[] = [];

  for (const [name, cfgs] of byName) {
    const dataLinks = buildDataLinks(cfgs);
    const values: Array<string | null> = [];

    for (let i = 0; i < lineField.values.length; i++) {
      const primary = cfgs[0];

      if (primary.matcherType === 'label' && labelsField) {
        const labels = parseLabelsValue(labelsField.values[i]);
        const val = labels?.[primary.matcherRegex] ?? null;
        values.push(val ?? null);
      } else {
        // regex match on log line
        const line: string = lineField.values[i] ?? '';
        try {
          const match = line.match(primary.matcherRegex);
          values.push(match?.[1] ?? null);
        } catch {
          values.push(null);
        }
      }
    }

    newFields.push({
      name,
      type: FieldType.string,
      config: { links: dataLinks },
      values,
    });
  }

  return {
    ...frame,
    fields: [...frame.fields, ...newFields],
  };
}

function buildDataLinks(cfgs: DerivedFieldConfig[]): DataLink[] {
  const srv = getDataSourceSrv();

  return cfgs.flatMap((cfg) => {
    if (cfg.datasourceUid) {
      const ds = srv.getInstanceSettings(cfg.datasourceUid);
      return [
        {
          title: cfg.urlDisplayLabel || '',
          url: '',
          internal: {
            // For our own VictoriaTraces datasource use the traceId query type.
            // For Tempo use traceql. For everything else pass the raw value as-is.
            query: buildInternalQuery(ds?.type, cfg.url ?? '${__value.raw}'),
            datasourceUid: cfg.datasourceUid,
            datasourceName: ds?.name ?? 'Data source not found',
          },
        } as DataLink,
      ];
    }
    if (cfg.url) {
      return [{ title: cfg.urlDisplayLabel || '', url: cfg.url } as DataLink];
    }
    return [];
  });
}

function buildInternalQuery(dsType: string | undefined, urlOrQuery: string): object {
  switch (dsType) {
    case 'victoriametrics-traces-datasource':
      return { queryType: 'traceId', traceId: urlOrQuery };
    case 'tempo':
      return { query: urlOrQuery, queryType: 'traceql' };
    case 'grafana-x-ray-datasource':
      return { query: urlOrQuery, queryType: 'getTrace' };
    default:
      return { query: urlOrQuery };
  }
}
