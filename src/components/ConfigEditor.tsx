import React, { lazy, Suspense, useCallback } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import {
  Button,
  DataSourceHttpSettings,
  Field,
  IconButton,
  InlineField,
  InlineSwitch,
  Input,
  LoadingPlaceholder,
  Stack,
} from '@grafana/ui';
import { DataSourcePicker } from '@grafana/runtime';
import {
  DEFAULT_TRACE_TO_LOGS_QUERY,
  DerivedFieldConfig,
  TraceToLogsOptions,
  TraceToMetricsLabelMapping,
  TraceToMetricsOptions,
  TraceToMetricsQuery,
  VictoriaTracesOptions,
} from '../types';

const DerivedFields = lazy(() =>
  import(/* webpackChunkName: "derived-fields" */ './DerivedFields').then((m) => ({
    default: m.DerivedFields,
  }))
);

type Props = DataSourcePluginOptionsEditorProps<VictoriaTracesOptions>;

const PLACEHOLDER_TAGS = ['service', 'service_name', 'job', 'app'];

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const jsonData = options.jsonData;
  const metricsQueries = jsonData.traceToMetrics?.queries ?? [];

  const onNodeGraphToggle = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      onOptionsChange({
        ...options,
        jsonData: {
          ...jsonData,
          nodeGraph: { ...jsonData.nodeGraph, enabled: (e.target as HTMLInputElement).checked },
        },
      });
    },
    [options, jsonData, onOptionsChange]
  );

  const onDerivedFieldsChange = useCallback(
    (fields: DerivedFieldConfig[]) => {
      onOptionsChange({ ...options, jsonData: { ...jsonData, derivedFields: fields } });
    },
    [options, jsonData, onOptionsChange]
  );

  const updateTraceToLogs = useCallback(
    (patch: Partial<TraceToLogsOptions>) => {
      onOptionsChange({
        ...options,
        jsonData: { ...jsonData, traceToLogs: { ...jsonData.traceToLogs, ...patch } },
      });
    },
    [options, jsonData, onOptionsChange]
  );

  const updateTraceToMetrics = useCallback(
    (patch: Partial<TraceToMetricsOptions>) => {
      onOptionsChange({
        ...options,
        jsonData: { ...jsonData, traceToMetrics: { ...jsonData.traceToMetrics, ...patch } },
      });
    },
    [options, jsonData, onOptionsChange]
  );

  const setMetricsQueries = useCallback(
    (queries: TraceToMetricsQuery[]) => updateTraceToMetrics({ queries }),
    [updateTraceToMetrics]
  );

  const updateMetricsQuery = (index: number, patch: Partial<TraceToMetricsQuery>) => {
    const next = metricsQueries.slice();
    next[index] = { ...next[index], ...patch };
    setMetricsQueries(next);
  };

  const removeMetricsQuery = (index: number) => {
    setMetricsQueries(metricsQueries.filter((_, i) => i !== index));
  };

  const addMetricsQuery = () => {
    setMetricsQueries([...metricsQueries, { name: '', query: '' }]);
  };

  const labelMappings = jsonData.traceToMetrics?.labelMappings ?? [];

  const setLabelMappings = useCallback(
    (next: TraceToMetricsLabelMapping[]) => updateTraceToMetrics({ labelMappings: next }),
    [updateTraceToMetrics]
  );

  const updateLabelMapping = (index: number, patch: Partial<TraceToMetricsLabelMapping>) => {
    const next = labelMappings.slice();
    next[index] = { ...next[index], ...patch };
    setLabelMappings(next);
  };

  const removeLabelMapping = (index: number) => {
    setLabelMappings(labelMappings.filter((_, i) => i !== index));
  };

  const addLabelMapping = () => {
    setLabelMappings([...labelMappings, { spanField: '', metricLabel: '' }]);
  };

  return (
    <Stack direction="column" gap={4}>
      <DataSourceHttpSettings
        defaultUrl="http://localhost:10428"
        dataSourceConfig={options}
        onChange={onOptionsChange}
      />

      <div>
        <h3 className="page-heading">Node Graph</h3>
        <InlineField
          label="Enable node graph"
          tooltip="Show service dependency graph alongside traces (like Tempo/Jaeger)"
          labelWidth={26}
        >
          <InlineSwitch
            value={jsonData.nodeGraph?.enabled ?? true}
            onChange={onNodeGraphToggle}
          />
        </InlineField>
      </div>

      <div>
        <h3 className="page-heading">Trace to Logs</h3>
        <p>
          Click the <strong>Logs</strong> button in a span to open the linked logs datasource
          filtered to the trace + service. Works out of the box for OTel-ingested VictoriaLogs;
          customise the query if your logs use a different schema.
        </p>
        <InlineField
          label="Data source"
          tooltip="Logs datasource (e.g. VictoriaLogs) to link to from trace spans."
          labelWidth={26}
        >
          <DataSourcePicker
            current={jsonData.traceToLogs?.datasourceUid}
            noDefault
            onChange={(ds) => updateTraceToLogs({ datasourceUid: ds.uid })}
          />
        </InlineField>
        <InlineField
          label="Query"
          tooltip='LogsQL template. Placeholders: ${__span.service}, ${__span.operation}, ${__span.traceId}, ${__span.spanId}, ${__span.tags.X}. Leave empty to use the OTel default.'
          labelWidth={26}
          grow
        >
          <Input
            placeholder={DEFAULT_TRACE_TO_LOGS_QUERY}
            value={jsonData.traceToLogs?.query ?? ''}
            onChange={(e) => updateTraceToLogs({ query: e.currentTarget.value })}
          />
        </InlineField>
      </div>

      <div>
        <h3 className="page-heading">Trace to Metrics</h3>
        <p>
          Two ways to drive the Metrics buttons in the span side panel:
        </p>
        <ul>
          <li>
            <strong>Label mappings</strong> — map a span field (service, trace_id, custom tag…)
            to the metric label it corresponds to. The plugin auto-builds a single
            MetricsQL selector <code>{'{label="value", ...}'}</code> and renders one
            <em> Metrics</em> button. Use this when you just want &quot;show me this
            service&apos;s metrics&quot;.
          </li>
          <li>
            <strong>Named queries</strong> — write full MetricsQL queries with{' '}
            <code>{'${__span.X}'}</code> placeholders. Each row becomes its own button (typical
            RED setup: Rate, Errors, Duration). Overrides the auto-built mapping when set.
          </li>
        </ul>
        <p>
          Tip: confirm which label your metrics use ({PLACEHOLDER_TAGS.join(' / ')}) by running{' '}
          <code>{'{label="..."}'}</code> in your metrics Explore first.
        </p>
        <InlineField
          label="Data source"
          tooltip="Metrics datasource (e.g. VictoriaMetrics) to link to from trace spans."
          labelWidth={26}
        >
          <DataSourcePicker
            current={jsonData.traceToMetrics?.datasourceUid}
            noDefault
            onChange={(ds) => updateTraceToMetrics({ datasourceUid: ds.uid })}
          />
        </InlineField>

        <Field
          label="Label mappings"
          description="Span field → metric label. Used to auto-build a selector when no named queries are set."
        >
          <Stack direction="column" gap={1}>
            {labelMappings.map((m, i) => (
              <Stack key={i} direction="row" gap={1} alignItems="center">
                <Input
                  width={24}
                  placeholder="Span field (e.g. service, trace_id, tags.http.method)"
                  value={m.spanField}
                  onChange={(e) => updateLabelMapping(i, { spanField: e.currentTarget.value })}
                />
                <span>→</span>
                <Input
                  width={24}
                  placeholder="Metric label (e.g. service, trace_id)"
                  value={m.metricLabel}
                  onChange={(e) => updateLabelMapping(i, { metricLabel: e.currentTarget.value })}
                />
                <IconButton
                  name="trash-alt"
                  tooltip="Remove mapping"
                  onClick={() => removeLabelMapping(i)}
                />
              </Stack>
            ))}
            <div>
              <Button variant="secondary" size="sm" icon="plus" onClick={addLabelMapping}>
                Add mapping
              </Button>
            </div>
          </Stack>
        </Field>

        <Field
          label="Named queries (advanced)"
          description="Each row renders a button in the span side panel. Overrides Label mappings when present."
        >
          <Stack direction="column" gap={1}>
            {metricsQueries.map((q, i) => (
              <Stack key={i} direction="row" gap={1} alignItems="center">
                <Input
                  width={18}
                  placeholder="Name (e.g. Rate)"
                  value={q.name}
                  onChange={(e) => updateMetricsQuery(i, { name: e.currentTarget.value })}
                />
                <Input
                  placeholder='rate(my_metric{service="${__span.service}"}[$__rate_interval])'
                  value={q.query}
                  onChange={(e) => updateMetricsQuery(i, { query: e.currentTarget.value })}
                />
                <IconButton
                  name="trash-alt"
                  tooltip="Remove query"
                  onClick={() => removeMetricsQuery(i)}
                />
              </Stack>
            ))}
            <div>
              <Button variant="secondary" size="sm" icon="plus" onClick={addMetricsQuery}>
                Add query
              </Button>
            </div>
          </Stack>
        </Field>
      </div>

      <Suspense fallback={<LoadingPlaceholder text="Loading derived fields…" />}>
        <DerivedFields fields={jsonData.derivedFields} onChange={onDerivedFieldsChange} />
      </Suspense>
    </Stack>
  );
}
