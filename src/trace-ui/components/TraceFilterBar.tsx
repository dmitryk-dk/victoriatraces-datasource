import React, { useMemo, useState } from 'react';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, MultiSelect, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { MonacoQueryFieldWrapper } from '../../components/monaco-query-field/MonacoQueryFieldWrapper';
import { useFieldNames, useFieldValues, useOperations, useServices, type MetaRange } from '../api/traces';
import { appendFilter, applyFilterAt } from '../filters/applyFilter';
import { fieldKeyOptions, isHiddenTagKey, normalizeTagKey } from '../filters/tagKeys';
import { SpanTypeId, TraceFilter, TraceFilterKind } from '../filters/types';
import { AddTraceFilterButton } from './AddTraceFilterButton';
import { TraceFilterBadge } from './TraceFilterBadge';

// Kinds that only make sense once; a second limit or error filter is noise.
const SINGLETON_KINDS = new Set<TraceFilterKind>(['error', 'limit', 'duration', 'spans']);

// A filter being added exists as a badge with its form already open, before it
// has any values. visum does the same: you see where the filter will land while
// you fill it in. It only joins the real list once applied.
const PENDING_INDEX = -1;

function blankFilter(kind: TraceFilterKind): TraceFilter {
  switch (kind) {
    case 'tag':
      return { kind, key: '', value: '' };
    case 'field':
      return { kind, mode: 'field', field: '', operator: 'equals', value: '' };
    case 'operation':
      return { kind, value: '' };
    case 'duration':
      return { kind };
    case 'spans':
      return { kind };
    case 'error':
      return { kind };
    case 'limit':
      return { kind, value: 50 };
    case 'spanType':
      return { kind, value: 'http' };
  }
}

interface Props {
  uid?: string;
  /** Range on screen; key and value suggestions are scoped to it. */
  range?: MetaRange;
  services: string[];
  filters: TraceFilter[];
  rawQuery: string;
  onServicesChange: (services: string[]) => void;
  onFiltersChange: (filters: TraceFilter[]) => void;
  onRawQueryChange: (query: string) => void;
}

export function TraceFilterBar({
  uid,
  range,
  services,
  filters,
  rawQuery,
  onServicesChange,
  onFiltersChange,
  onRawQueryChange,
}: Props) {
  const styles = useStyles2(getStyles);

  // Which badge has its editor open: an index into `filters`, or PENDING_INDEX
  // for one being added.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pending, setPending] = useState<TraceFilter | null>(null);
  // The tag key whose values the value picker should offer.
  const [activeTagKey, setActiveTagKey] = useState<string>('');

  const serviceList = useServices(uid);
  // Operations are service-scoped; with several selected, offer the first
  // service's operations rather than an unfiltered global list.
  const operationList = useOperations(uid, services[0]);
  const fieldNames = useFieldNames(uid, services[0], range);
  const fieldValues = useFieldValues(uid, activeTagKey || undefined, services[0], range);

  const serviceOptions: Array<SelectableValue<string>> = useMemo(
    () => (serviceList.data ?? []).map((s) => ({ label: s, value: s })),
    [serviceList.data]
  );

  const tagKeys = useMemo(
    () =>
      [
        ...new Set(
          // Tag keys keep the picker's order (busiest first), deduplicated
          // once the storage prefix is stripped.
          (fieldNames.data ?? [])
            .filter((f) => !isHiddenTagKey(f.value))
            .sort((a, b) => b.hits - a.hits)
            .map((f) => normalizeTagKey(f.value))
        ),
      ],
    [fieldNames.data]
  );

  // Tag filters match a bare name against every storage prefix, so they take
  // the normalized list above. A field filter names one field exactly, so it
  // needs the storage name the backend reported.
  const fieldKeys = useMemo(() => fieldKeyOptions(fieldNames.data ?? []), [fieldNames.data]);

  const activeSpanType = filters.find((f) => f.kind === 'spanType')?.value as SpanTypeId | undefined;

  const disabledKinds = useMemo(
    () => new Set([...SINGLETON_KINDS].filter((k) => filters.some((f) => f.kind === k))),
    [filters]
  );

  const startAdding = (kind: TraceFilterKind) => {
    setPending(blankFilter(kind));
    setActiveTagKey('');
    setOpenIndex(PENDING_INDEX);
  };

  const applyPending = (next: TraceFilter) => {
    onFiltersChange(appendFilter(filters, next));
    setPending(null);
    setOpenIndex(null);
  };

  const applyExisting = (index: number, next: TraceFilter) => {
    onFiltersChange(applyFilterAt(filters, index, next));
    setOpenIndex(null);
  };

  // Span type is chosen straight from the menu, so it replaces any existing one
  // rather than opening a form.
  const setSpanType = (value: SpanTypeId) => {
    const without = filters.filter((f) => f.kind !== 'spanType');
    onFiltersChange([...without, { kind: 'spanType', value }]);
  };

  const removeFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
    setOpenIndex(null);
  };

  const badgeProps = {
    operations: operationList.data ?? [],
    tagKeys,
    fieldKeys,
    tagValues: fieldValues.data ?? [],
    onTagKeyChange: setActiveTagKey,
  };

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <MultiSelect
          options={serviceOptions}
          value={services}
          onChange={(v) => onServicesChange(v.map((o) => o.value!).filter(Boolean))}
          placeholder="All services"
          isLoading={serviceList.loading}
          width={36}
          aria-label="Services"
        />

        {filters.map((filter, index) => (
          <TraceFilterBadge
            key={`${filter.kind}-${index}`}
            filter={filter}
            open={openIndex === index}
            onOpenChange={(open) => {
              setOpenIndex(open ? index : null);
              if (open && filter.kind === 'tag') {
                setActiveTagKey(filter.key);
              }
            }}
            onApply={(next) => applyExisting(index, next)}
            onRemove={() => removeFilter(index)}
            {...badgeProps}
          />
        ))}

        {pending && (
          <TraceFilterBadge
            filter={pending}
            open={openIndex === PENDING_INDEX}
            onOpenChange={(open) => {
              setOpenIndex(open ? PENDING_INDEX : null);
              if (!open) {
                // Abandoning the form discards the half-built filter.
                setPending(null);
              }
            }}
            onApply={applyPending}
            onRemove={() => {
              setPending(null);
              setOpenIndex(null);
            }}
            {...badgeProps}
          />
        )}

        <AddTraceFilterButton
          onAdd={startAdding}
          onAddSpanType={setSpanType}
          activeSpanType={activeSpanType}
          disabledKinds={disabledKinds}
        />

        {filters.length > 0 && (
          <Button size="sm" variant="secondary" fill="text" onClick={() => onFiltersChange([])}>
            Clear all
          </Button>
        )}
      </div>

      <div className={styles.query}>
        <MonacoQueryFieldWrapper
          history={[]}
          initialValue={rawQuery}
          placeholder="Filter with LogsQL…"
          onChange={onRawQueryChange}
          onRunQuery={() => {}}
          runQueryOnBlur
        />
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  query: css({
    // The Monaco field sizes to its container rather than its content.
    width: '100%',
  }),
});
