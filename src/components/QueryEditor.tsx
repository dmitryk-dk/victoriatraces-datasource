import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import {
  CoreApp,
  GrafanaTheme2,
  isValidGrafanaDuration,
  LoadingState,
  QueryEditorProps,
  SelectableValue,
} from '@grafana/data';
import {
  Alert,
  AutoSizeInput,
  Button,
  Field,
  Input,
  RadioButtonGroup,
  Select,
  Stack,
  useStyles2,
} from '@grafana/ui';

import { DataSource, isTailableExpr } from '../datasource';
import { notifyError } from '../notify';
import { defaultQuery, QueryType, VictoriaTracesOptions, VictoriaTracesQuery } from '../types';
import { MonacoQueryFieldWrapper } from './monaco-query-field/MonacoQueryFieldWrapper';
import { useDefaultExploreGraph, EXPLORE_GRAPH_STYLES } from './hooks/useDefaultExploreGraph';
import { useLogsSort } from './hooks/useLogsSort';
import { EditorRow } from './EditorRow';
import EditorField from './EditorField';
import QueryEditorOptionsGroup from './QueryEditorOptionsGroup';
import { TagsInput } from './TagsInput';
import { TraceFilterBar } from '../trace-ui/components/TraceFilterBar';
import { buildTraceListQuery } from '../trace-ui/filters/logsql';
import type { TraceFilter } from '../trace-ui/filters/types';

type Props = QueryEditorProps<DataSource, VictoriaTracesQuery, VictoriaTracesOptions>;

const entityOptions: Array<SelectableValue<'traces' | 'spans'>> = [
  { label: 'Traces', value: 'traces' },
  { label: 'Spans', value: 'spans' },
];

const topQueryTypeOptions: Array<SelectableValue<QueryType>> = [
  { label: 'Traces', value: 'traceList' },
  { label: 'Search', value: 'search' },
  { label: 'Trace ID', value: 'traceId' },
  { label: 'LogsQL', value: 'logsql' },
];

const logsqlModeOptions: Array<SelectableValue<QueryType>> = [
  {
    label: 'Raw Logs',
    value: 'logsql-logs',
    description: 'Raw span/log records — /select/logsql/query',
  },
  {
    label: 'Range',
    value: 'logsql',
    description: 'Time-series graph — /select/logsql/stats_query_range',
  },
  {
    label: 'Instant',
    value: 'logsql-instant',
    description: 'Single value — /select/logsql/stats_query',
  },
];

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  header: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    minHeight: theme.spacing(4),
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  }),
  fieldGrow: css({
    flex: '1 1 180px',
    minWidth: 0,
    marginBottom: 0,
  }),
  fieldFixed: css({
    flex: '0 0 auto',
    marginBottom: 0,
  }),
  queryTypeBar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    paddingBottom: theme.spacing(0.5),
  }),
});

function getCollapsedInfo(q: VictoriaTracesQuery): string[] {
  const items: string[] = [];
  const modeLabel = logsqlModeOptions.find((o) => o.value === q.queryType)?.label ?? 'Raw Logs';
  items.push(`Type: ${modeLabel}`);
  if (q.legendFormat && q.queryType !== 'logsql-logs') {
    items.push(`Legend: ${q.legendFormat}`);
  }
  if (q.queryType === 'logsql' && q.step) {
    const valid = isValidGrafanaDuration(q.step) || !isNaN(+q.step);
    items.push(`Step: ${valid ? q.step : 'Invalid value'}`);
  }
  if (q.queryType === 'logsql-logs' && q.limit) {
    items.push(`Line limit: ${q.limit}`);
  }
  return items;
}

export function QueryEditor({ datasource, query, onChange, onRunQuery, data, app, range }: Props) {
  const styles = useStyles2(getStyles);
  const q = useMemo(() => ({ ...defaultQuery, ...query }), [query]);

  useDefaultExploreGraph(app, EXPLORE_GRAPH_STYLES.BARS);
  useLogsSort(app, q, onChange, onRunQuery);

  const [services, setServices] = useState<Array<SelectableValue<string>>>([]);
  const [operations, setOperations] = useState<Array<SelectableValue<string>>>([]);

  useEffect(() => {
    let cancelled = false;
    datasource
      .getServices()
      .then((list) => {
        if (!cancelled) {
          setServices(list.map((s) => ({ label: s, value: s })));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setServices([]);
          notifyError('Failed to load services', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  useEffect(() => {
    if (!q.serviceName) {
      setOperations([]);
      return;
    }
    let cancelled = false;
    datasource
      .getOperations(q.serviceName)
      .then((list) => {
        if (!cancelled) {
          setOperations(list.map((o) => ({ label: o, value: o })));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOperations([]);
          notifyError(`Failed to load operations for ${q.serviceName}`, err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource, q.serviceName]);

  const isLogsQL =
    q.queryType === 'logsql' ||
    q.queryType === 'logsql-instant' ||
    q.queryType === 'logsql-logs';

  useEffect(() => {
    if (!q.expr && isLogsQL && app === CoreApp.Explore) {
      onChange({ ...q, expr: '*' });
      onRunQuery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Top-level radio collapses every logsql-* sub-type into the single "LogsQL"
  // option, and both list modes into "Traces" — spans vs traces is chosen by
  // its own toggle rather than by the query type.
  const topLevelType: QueryType =
    q.queryType === 'logsql-instant' || q.queryType === 'logsql-logs'
      ? 'logsql'
      : q.queryType === 'spanList'
        ? 'traceList'
        : q.queryType;

  const collapsedInfo = useMemo(() => getCollapsedInfo(q), [q]);

  const isValidStep = useMemo(
    () => !q.step || isValidGrafanaDuration(q.step) || !isNaN(+q.step),
    [q.step]
  );

  const onTopTypeChange = useCallback(
    (value: QueryType) => {
      const resolved =
        value === 'logsql'
          ? 'logsql-logs'
          : value === 'traceList' && q.entity === 'spans'
            ? 'spanList'
            : value;
      onChange({ ...q, queryType: resolved });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  // The bar edits structured filters; the backend takes the LogsQL they derive.
  // Both are stored so a saved query reopens with its filters intact.
  const applyTraceFilters = useCallback(
    (next: {
      services?: string[];
      traceFilters?: TraceFilter[];
      rawQuery?: string;
      entity?: 'traces' | 'spans';
    }) => {
      const services = next.services ?? q.services ?? [];
      const traceFilters = next.traceFilters ?? q.traceFilters ?? [];
      const rawQuery = next.rawQuery ?? q.expr ?? '';
      const entity = next.entity ?? q.entity ?? 'traces';
      // The same filters mean different LogsQL in each mode, so the derived
      // query is rebuilt whenever either changes.
      const derived = buildTraceListQuery({ filters: traceFilters, services, rawQuery, entity });

      onChange({
        ...q,
        queryType: entity === 'spans' ? 'spanList' : 'traceList',
        entity,
        services,
        traceFilters,
        expr: rawQuery,
        where: derived.where,
        postFilter: derived.postFilter,
        matchCond: derived.matchCond,
        limit: derived.limit ?? q.limit,
      });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onLogsqlModeChange = useCallback(
    (value: QueryType) => {
      onChange({ ...q, queryType: value });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onExprChange = useCallback(
    (value: string) => {
      onChange({ ...q, expr: value });
    },
    [onChange, q]
  );

  const onLegendCommit = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      onChange({ ...q, legendFormat: e.currentTarget.value || undefined });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onStepChange = useCallback(
    (e: React.SyntheticEvent<HTMLInputElement>) => {
      onChange({ ...q, step: e.currentTarget.value.trim() });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onMaxLinesChange = useCallback(
    (e: React.SyntheticEvent<HTMLInputElement>) => {
      const v = parseInt(e.currentTarget.value, 10);
      const limit = isNaN(v) || v < 0 ? undefined : v;
      if (q.limit !== limit) {
        onChange({ ...q, limit });
        onRunQuery();
      }
    },
    [onChange, onRunQuery, q]
  );

  // Clearing or swapping the service invalidates operation + tags — drop them.
  const onServiceChange = useCallback(
    (value: SelectableValue<string> | null) => {
      onChange({
        ...q,
        serviceName: value?.value,
        operationName: undefined,
        tags: undefined,
      });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onOperationChange = useCallback(
    (value: SelectableValue<string> | null) => {
      onChange({ ...q, operationName: value?.value });
      onRunQuery();
    },
    [onChange, onRunQuery, q]
  );

  const onTagsChange = useCallback(
    (newTags: string) => {
      onChange({ ...q, tags: newTags });
    },
    [onChange, q]
  );

  const onSearchLimitChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...q, limit: parseInt(e.target.value, 10) || 20 });
    },
    [onChange, q]
  );

  const onTraceIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...q, traceId: e.target.value });
    },
    [onChange, q]
  );

  const isDataLoading = data?.state === LoadingState.Loading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>
      {/* ── Query-type selector + Trace ID input ── */}
      <div className={styles.queryTypeBar}>
        <Field label="Query type" style={{ marginBottom: 0 }}>
          <RadioButtonGroup
            options={topQueryTypeOptions}
            value={topLevelType}
            onChange={onTopTypeChange}
          />
        </Field>

        {q.queryType === 'traceId' && (
          <Field label="Trace ID" style={{ marginBottom: 0, flex: '1 1 220px', minWidth: 0 }}>
            <Input
              value={q.traceId ?? ''}
              placeholder="e.g. 3fa414edcef6ad90"
              onChange={onTraceIdChange}
              onBlur={onRunQuery}
            />
          </Field>
        )}

        {/* Run Query button — non-Explore only, right-aligned */}
        {isLogsQL && app !== CoreApp.Explore && (
          <Stack direction="row" justifyContent="flex-end" flex={1}>
            <Button
              variant={data && !isDataLoading ? 'secondary' : 'primary'}
              size="sm"
              onClick={onRunQuery}
              icon={isDataLoading ? 'fa fa-spinner' : undefined}
              disabled={isDataLoading}
            >
              Run query
            </Button>
          </Stack>
        )}
      </div>

      {/* ── LogsQL mode ── */}
      {isLogsQL && (
        <>
          {/* Monaco expression editor */}
          <MonacoQueryFieldWrapper
            history={[]}
            onChange={onExprChange}
            onRunQuery={onRunQuery}
            initialValue={q.expr ?? ''}
            placeholder='Enter a LogsQL expression, e.g.  * | stats by ("resource_attr:service.name") count() requests'
            runQueryOnBlur
          />

          {q.queryType === 'logsql-logs' && q.expr && !isTailableExpr(q.expr) && (
            <Alert severity="info" title="This query cannot be live-tailed">
              Live tailing rejects pipes that aggregate, reorder, or paginate logs:{' '}
              <code>stats</code>, <code>uniq</code>, <code>top</code>, <code>sort</code>,{' '}
              <code>limit</code>, <code>offset</code>. Remove them to enable live tail, or
              run the query without live mode.
            </Alert>
          )}

          {/* Collapsible Options row */}
          <EditorRow>
            <QueryEditorOptionsGroup title="Options" collapsedInfo={collapsedInfo}>
              <EditorField label="Type">
                <RadioButtonGroup
                  options={logsqlModeOptions}
                  value={q.queryType}
                  onChange={onLogsqlModeChange}
                />
              </EditorField>

              {q.queryType !== 'logsql-logs' && (
                <EditorField
                  label="Legend"
                  tooltip='Series name template. Use {{ label }} placeholders, e.g. "{{ resource_attr:service.name }}".'
                >
                  <AutoSizeInput
                    placeholder="{{label}}"
                    type="string"
                    minWidth={14}
                    defaultValue={q.legendFormat ?? ''}
                    onCommitChange={onLegendCommit}
                  />
                </EditorField>
              )}

              {q.queryType === 'logsql' && (
                <EditorField
                  label="Step"
                  tooltip='Override the auto-calculated step, e.g. "1m", "5m", "1h". Leave empty for auto.'
                  invalid={!isValidStep}
                  error="Invalid step. Example valid values: 1s, 5m, 10h, 1d."
                >
                  <AutoSizeInput
                    placeholder="auto"
                    type="string"
                    minWidth={8}
                    defaultValue={q.step ?? ''}
                    onCommitChange={onStepChange}
                  />
                </EditorField>
              )}

              {q.queryType === 'logsql-logs' && (
                <EditorField
                  label="Line limit"
                  tooltip="Upper limit for number of log/span records returned by query."
                >
                  <AutoSizeInput
                    placeholder="1000"
                    type="number"
                    min={0}
                    minWidth={8}
                    defaultValue={q.limit?.toString() ?? ''}
                    onCommitChange={onMaxLinesChange}
                  />
                </EditorField>
              )}
            </QueryEditorOptionsGroup>
          </EditorRow>
        </>
      )}

      {/* ── Traces mode: visum-style filter bar ── */}
      {(q.queryType === 'traceList' || q.queryType === 'spanList') && (
        <div className={styles.row}>
          <RadioButtonGroup
            options={entityOptions}
            value={q.entity ?? 'traces'}
            onChange={(entity) => applyTraceFilters({ entity })}
            size="sm"
          />
          <TraceFilterBar
            uid={datasource.uid}
            range={{ start: range?.from.toISOString(), end: range?.to.toISOString() }}
            services={q.services ?? []}
            filters={q.traceFilters ?? []}
            rawQuery={q.expr ?? ''}
            onServicesChange={(services) => applyTraceFilters({ services })}
            onFiltersChange={(traceFilters) => applyTraceFilters({ traceFilters })}
            onRawQueryChange={(rawQuery) => applyTraceFilters({ rawQuery })}
          />
        </div>
      )}

      {/* ── Search mode ── */}
      {q.queryType === 'search' && (
        <>
          <div className={styles.row}>
            <Field label="Service" className={styles.fieldGrow}>
              <Select
                options={services}
                value={q.serviceName}
                onChange={onServiceChange}
                placeholder="Select service"
                isClearable
              />
            </Field>
            <Field label="Operation" className={styles.fieldGrow}>
              <Select
                options={operations}
                value={q.operationName}
                onChange={onOperationChange}
                placeholder="Select operation"
                isClearable
                disabled={!q.serviceName}
              />
            </Field>
            <Field
              label="Min duration"
              description="Only traces at least this long, e.g. 100ms"
              className={styles.fieldFixed}
            >
              <Input
                value={q.minDuration ?? ''}
                placeholder="100ms"
                onChange={(e) => onChange({ ...q, minDuration: e.currentTarget.value })}
                onBlur={onRunQuery}
                width={12}
              />
            </Field>
            <Field
              label="Max duration"
              description="Only traces no longer than this, e.g. 2s"
              className={styles.fieldFixed}
            >
              <Input
                value={q.maxDuration ?? ''}
                placeholder="2s"
                onChange={(e) => onChange({ ...q, maxDuration: e.currentTarget.value })}
                onBlur={onRunQuery}
                width={12}
              />
            </Field>
            <Field label="Limit" className={styles.fieldFixed}>
              <Input
                type="number"
                value={q.limit ?? 20}
                min={1}
                max={1000}
                onChange={onSearchLimitChange}
                onBlur={onRunQuery}
                width={8}
              />
            </Field>
          </div>
          <div className={styles.row}>
            <Field
              label="Tags"
              description="Select tag key and value from suggestions, or type custom values"
              className={styles.fieldGrow}
            >
              <TagsInput
                datasource={datasource}
                tags={q.tags ?? ''}
                serviceName={q.serviceName}
                range={{ start: range?.from.toISOString(), end: range?.to.toISOString() }}
                onChange={onTagsChange}
                onBlur={onRunQuery}
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}
