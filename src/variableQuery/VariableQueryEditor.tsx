import React, { FormEvent, useEffect, useState } from 'react';
import { InlineField, InlineFieldRow, Input, Select } from '@grafana/ui';
import { SelectableValue } from '@grafana/data';
import { debounce } from 'lodash';

import { DataSource } from '../datasource';
import { notifyError } from '../notify';
import { VariableQuery, VariableQueryType, defaultVariableQuery } from './types';

const QUERY_TYPE_OPTIONS: Array<SelectableValue<VariableQueryType>> = [
  { label: 'Field names', value: 'fieldName' },
  { label: 'Field values', value: 'fieldValue' },
];

const refId = 'VictoriaTracesVariableQueryEditor-VariableQuery';

interface Props {
  query: VariableQuery;
  datasource: DataSource;
  onChange: (query: VariableQuery, definition: string) => void;
}

export function VariableQueryEditor({ query, datasource, onChange }: Props) {
  const [type, setType] = useState<VariableQueryType>(query?.type ?? defaultVariableQuery.type!);
  const [field, setField] = useState<string>(query?.field ?? '');
  const [limit, setLimit] = useState<number>(query?.limit ?? 100);
  const [queryFilter, setQueryFilter] = useState<string>(query?.query ?? '');
  const [fieldNames, setFieldNames] = useState<Array<SelectableValue<string>>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const emitChange = (patch: Partial<VariableQuery>) => {
    const updated: VariableQuery = { refId, type, field, limit, query: queryFilter, ...patch };
    onChange(updated, `${updated.type}(${updated.field ?? ''}, ${updated.limit ?? 100})`);
  };

  const handleTypeChange = (v: SelectableValue<VariableQueryType>) => {
    if (!v.value) {
      return;
    }
    setType(v.value);
    emitChange({ type: v.value });
  };

  const handleFieldChange = (v: SelectableValue<string>) => {
    setField(v.value ?? '');
  };

  const handleBlur = () => {
    emitChange({ field, limit, query: queryFilter });
  };

  const handleQueryFilterChange = (e: FormEvent<HTMLInputElement>) => {
    setQueryFilter(e.currentTarget.value);
  };

  const handleLimitChange = (e: FormEvent<HTMLInputElement>) => {
    const value = Number(e.currentTarget.value);
    setLimit(isNaN(value) ? 100 : value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  useEffect(() => {
    if (!query) {
      return;
    }
    setType(query.type ?? 'fieldName');
    setField(query.field ?? '');
    setQueryFilter(query.query ?? '');
    setLimit(query.limit ?? 100);
  }, [query]);

  useEffect(() => {
    if (type !== 'fieldValue') {
      return;
    }

    let cancelled = false;

    const fetchFieldNames = async () => {
      setIsLoading(true);
      try {
        const names = await datasource.getFieldNames(undefined, queryFilter || undefined);
        if (!cancelled) {
          setFieldNames(names.map((n) => ({ label: n, value: n })));
        }
      } catch (err) {
        if (!cancelled) {
          notifyError('Failed to load field names', err);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    const debouncedFetch = debounce(fetchFieldNames, 1000);
    debouncedFetch();

    return () => {
      cancelled = true;
      debouncedFetch.cancel();
    };
  }, [datasource, type, queryFilter]);

  return (
    <div>
      <InlineFieldRow>
        <InlineField label="Query type" labelWidth={20}>
          <Select
            aria-label="Query type"
            width={20}
            options={QUERY_TYPE_OPTIONS}
            value={type}
            onChange={handleTypeChange}
            onBlur={handleBlur}
          />
        </InlineField>
        {type === 'fieldValue' && (
          <InlineField label="Field" labelWidth={20}>
            <Select
              aria-label="Field value"
              width={20}
              options={fieldNames}
              value={field}
              onChange={handleFieldChange}
              onBlur={handleBlur}
              isLoading={isLoading}
            />
          </InlineField>
        )}
        <InlineField label="Limit" labelWidth={20} tooltip="Maximum number of values to return. Set to 0 to remove the limit.">
          <Input
            type="number"
            aria-label="Limit"
            placeholder="Limit"
            value={limit}
            onChange={handleLimitChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        </InlineField>
      </InlineFieldRow>
      <InlineFieldRow>
        <InlineField
          label="Query"
          labelWidth={20}
          grow
          tooltip="Optional. Filters logs based on the specified LogsQL query and returns the corresponding field names."
        >
          <Input
            type="text"
            aria-label="Query Filter"
            placeholder="Optional query filter"
            value={queryFilter}
            onChange={handleQueryFilterChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
        </InlineField>
      </InlineFieldRow>
    </div>
  );
}