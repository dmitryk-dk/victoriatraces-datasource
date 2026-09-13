import React, { useEffect, useMemo, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Icon, IconButton, Input, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { OPERATION_FIELD, SERVICE_FIELD } from '../api/traceList';
import { SPAN_TYPE_PRESETS, SpanTypeId, TraceFilter } from '../filters/types';
import { serviceColor } from '../utils/format';
import { orderFacetValues, type ScopedFacetValue } from './facetScope';

// How many values a group shows before the rest go behind "show more".
const VISIBLE_VALUES = 8;

/** A facet whose values may carry the in-scope marking from facetScope. */
export interface SidebarFacet {
  field: string;
  values: Array<{ value: string; count: number; inScope?: boolean }>;
}

interface Props {
  facets: SidebarFacet[];
  /** Keys offered by the tag section's picker. */
  tagKeys?: string[];
  loading: boolean;
  services: string[];
  filters: TraceFilter[];
  entity: 'traces' | 'spans';
  onEntityChange: (entity: 'traces' | 'spans') => void;
  onServicesChange: (services: string[]) => void;
  onFiltersChange: (filters: TraceFilter[]) => void;
  onClose: () => void;
}

/**
 * Faceted filter sidebar: the values actually present in the current range,
 * with the number of traces carrying each, so filtering is a matter of
 * recognition rather than recall.
 */
export function TraceFilterSidebar({
  facets,
  tagKeys = [],
  loading,
  services,
  filters,
  entity,
  onEntityChange,
  onServicesChange,
  onFiltersChange,
  onClose,
}: Props) {
  const styles = useStyles2(getStyles);

  const serviceValues = facets.find((f) => f.field === SERVICE_FIELD)?.values ?? [];
  const operationValues = facets.find((f) => f.field === OPERATION_FIELD)?.values ?? [];

  const operations = useMemo(
    () => filters.filter((f) => f.kind === 'operation').map((f) => f.value),
    [filters]
  );
  const errorOnly = filters.some((f) => f.kind === 'error');
  const activeSpanType = filters.find((f) => f.kind === 'spanType')?.value as SpanTypeId | undefined;

  const toggleOperation = (operation: string) => {
    const without = filters.filter((f) => !(f.kind === 'operation' && f.value === operation));
    onFiltersChange(
      without.length === filters.length ? [...filters, { kind: 'operation', value: operation }] : without
    );
  };

  const toggleErrorOnly = () => {
    onFiltersChange(
      errorOnly ? filters.filter((f) => f.kind !== 'error') : [...filters, { kind: 'error' }]
    );
  };

  const duration = filters.find((f) => f.kind === 'duration');
  const durationMin = duration?.kind === 'duration' ? (duration.min ?? '') : '';
  const durationMax = duration?.kind === 'duration' ? (duration.max ?? '') : '';

  const setDuration = (min: string, max: string) => {
    const without = filters.filter((f) => f.kind !== 'duration');
    onFiltersChange(
      min || max ? [...without, { kind: 'duration', min: min || undefined, max: max || undefined }] : without
    );
  };

  const tagFilters = useMemo(
    () => filters.filter((f): f is Extract<TraceFilter, { kind: 'tag' }> => f.kind === 'tag'),
    [filters]
  );

  const addTag = (key: string, value: string) => {
    // A key can only be filtered once: two equality conditions on one key are
    // ANDed and match nothing.
    onFiltersChange([
      ...filters.filter((f) => !(f.kind === 'tag' && f.key === key)),
      { kind: 'tag', key, value },
    ]);
  };

  const removeTag = (key: string) => {
    onFiltersChange(filters.filter((f) => !(f.kind === 'tag' && f.key === key)));
  };

  const setSpanType = (id: SpanTypeId) => {
    const without = filters.filter((f) => f.kind !== 'spanType');
    onFiltersChange(activeSpanType === id ? without : [...without, { kind: 'spanType', value: id }]);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Filters</span>
        <IconButton name="times" tooltip="Hide filters" aria-label="Hide filters" onClick={onClose} />
      </div>

      <div className={styles.tabs} role="tablist">
        {(['traces', 'spans'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={entity === value}
            className={entity === value ? styles.tabActive : styles.tab}
            onClick={() => onEntityChange(value)}
          >
            <Icon name={value === 'traces' ? 'sitemap' : 'layer-group'} size="sm" />
            {value === 'traces' ? 'Traces' : 'Spans'}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {loading && facets.length === 0 && <LoadingPlaceholder text="Loading filters…" />}

        <FacetGroup
          label="Service"
          values={serviceValues}
          selected={services}
          colorFor={serviceColor}
          onToggle={(value) =>
            onServicesChange(
              services.includes(value) ? services.filter((s) => s !== value) : [...services, value]
            )
          }
          onClear={() => onServicesChange([])}
        />

        <FacetGroup
          label="Operation"
          values={operationValues}
          selected={operations}
          onToggle={toggleOperation}
          onClear={() => onFiltersChange(filters.filter((f) => f.kind !== 'operation'))}
        />

        <TagSection
          tags={tagFilters}
          tagKeys={tagKeys}
          onAdd={addTag}
          onRemove={removeTag}
        />

        <DurationSection
          min={durationMin}
          max={durationMax}
          onApply={setDuration}
          onClear={() => setDuration('', '')}
        />

        <CollapsibleGroup label="Span type">
          {SPAN_TYPE_PRESETS.map((preset) => (
            <label key={preset.id} className={styles.row}>
              <Checkbox value={activeSpanType === preset.id} onChange={() => setSpanType(preset.id)} />
              <span className={styles.value}>{preset.label}</span>
            </label>
          ))}
        </CollapsibleGroup>

        <label className={styles.errorsOnly}>
          <Checkbox value={errorOnly} onChange={toggleErrorOnly} />
          <span>Errors only</span>
        </label>
      </div>
    </aside>
  );
}

interface FacetGroupProps {
  label: string;
  values: Array<{ value: string; count: number; inScope?: boolean }>;
  selected: string[];
  colorFor?: (value: string) => string;
  onToggle: (value: string) => void;
  onClear: () => void;
}

function FacetGroup({ label, values, selected, colorFor, onToggle, onClear }: FacetGroupProps) {
  const styles = useStyles2(getStyles);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const ordered = useMemo(() => {
    const scoped: ScopedFacetValue[] = values.map((v) => ({ ...v, inScope: v.inScope !== false }));
    return orderFacetValues(scoped, new Set(selected));
  }, [values, selected]);

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ordered.filter((v) => v.value.toLowerCase().includes(q)) : ordered;
  }, [ordered, search]);

  const filtered = useMemo(() => {
    if (showAll || matching.length <= VISIBLE_VALUES) {
      return matching;
    }
    // A selected value always stays visible, even past the cut-off, so the
    // sidebar never hides a filter that is currently in force.
    const shown = matching.slice(0, VISIBLE_VALUES);
    const missingSelected = matching.filter((v) => selected.includes(v.value) && !shown.includes(v));
    return [...shown, ...missingSelected];
  }, [matching, showAll, selected]);

  const hidden = matching.length - filtered.length;

  return (
    <section className={styles.group}>
      <button className={styles.groupHeader} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <Icon name={expanded ? 'angle-down' : 'angle-right'} size="sm" />
        {label}
        <span className={styles.groupCount}>({values.length})</span>
      </button>

      {expanded && selected.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          fill="text"
          onClick={onClear}
          aria-label={`Clear ${selected.length} selected ${label.toLowerCase()}s`}
        >
          Clear ({selected.length})
        </Button>
      )}

      {expanded && (
        <>
          {values.length > VISIBLE_VALUES && (
            <Input
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search values…"
              prefix={<Icon name="search" />}
              aria-label={`Search ${label} values`}
            />
          )}

          {filtered.map((v) => (
            <label
              key={v.value}
              className={v.inScope ? styles.row : styles.rowOutOfScope}
              title={
                v.inScope
                  ? v.value
                  : `${v.value} — no traces under the current filters`
              }
            >
              <Checkbox value={selected.includes(v.value)} onChange={() => onToggle(v.value)} />
              {colorFor && (
                <span aria-hidden="true" className={styles.dot} style={{ background: colorFor(v.value) }} />
              )}
              <span className={styles.value}>{v.value}</span>
              <span className={styles.count}>{v.count}</span>
            </label>
          ))}

          {hidden > 0 && (
            <Button size="sm" variant="secondary" fill="text" onClick={() => setShowAll(true)}>
              Show {hidden} more
            </Button>
          )}

          {filtered.length === 0 && <p className={styles.empty}>No matching values.</p>}
        </>
      )}
    </section>
  );
}

interface TagSectionProps {
  tags: Array<{ key: string; value: string }>;
  tagKeys: string[];
  onAdd: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}

/**
 * Tag filters, editable here as well as in the query editor — they are kept
 * in the sidebar, and a panel viewed on a dashboard has no query editor.
 */
function TagSection({ tags, tagKeys, onAdd, onRemove }: TagSectionProps) {
  const styles = useStyles2(getStyles);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const add = () => {
    if (!key.trim() || !value.trim()) {
      return;
    }
    onAdd(key.trim(), value.trim());
    setKey('');
    setValue('');
  };

  return (
    <section className={styles.group}>
      <div className={styles.groupHeaderStatic}>Tags</div>

      {tags.map((tag) => (
        <div key={tag.key} className={styles.row}>
          <span className={styles.value}>
            {tag.key}={tag.value}
          </span>
          <IconButton
            name="times"
            size="sm"
            tooltip={`Remove ${tag.key}=${tag.value}`}
            onClick={() => onRemove(tag.key)}
          />
        </div>
      ))}

      <div className={styles.durationRow}>
        <Input
          value={key}
          list={tagKeys.length > 0 ? 'sidebar-tag-keys' : undefined}
          onChange={(e) => setKey(e.currentTarget.value)}
          placeholder="key"
          aria-label="Tag key"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="value"
          aria-label="Tag value"
        />
      </div>
      {tagKeys.length > 0 && (
        <datalist id="sidebar-tag-keys">
          {tagKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      )}
      <Button size="sm" variant="secondary" fill="text" onClick={add} aria-label="Add tag filter">
        Add tag filter
      </Button>
    </section>
  );
}

interface DurationSectionProps {
  min: string;
  max: string;
  onApply: (min: string, max: string) => void;
  onClear: () => void;
}

/**
 * Duration bounds, editable here rather than only in the query editor: the
 * heatmap's drill writes one, and a filter that can be set from the panel has
 * to be clearable from the panel.
 */
function DurationSection({ min, max, onApply, onClear }: DurationSectionProps) {
  const styles = useStyles2(getStyles);
  const [draftMin, setDraftMin] = useState(min);
  const [draftMax, setDraftMax] = useState(max);

  // The bounds can change underneath — a chart drill writes them.
  useEffect(() => {
    setDraftMin(min);
    setDraftMax(max);
  }, [min, max]);

  return (
    <section className={styles.group}>
      <div className={styles.groupHeaderStatic}>
        Duration
        {(min || max) && (
          <IconButton
            name="times"
            size="sm"
            tooltip="Clear duration filter"
            aria-label="Clear duration filter"
            onClick={onClear}
          />
        )}
      </div>
      <div className={styles.durationRow}>
        <Input
          value={draftMin}
          onChange={(e) => setDraftMin(e.currentTarget.value)}
          onBlur={() => onApply(draftMin, draftMax)}
          onKeyDown={(e) => e.key === 'Enter' && onApply(draftMin, draftMax)}
          placeholder="min, e.g. 250ms"
          aria-label="Minimum duration"
        />
        <Input
          value={draftMax}
          onChange={(e) => setDraftMax(e.currentTarget.value)}
          onBlur={() => onApply(draftMin, draftMax)}
          onKeyDown={(e) => e.key === 'Enter' && onApply(draftMin, draftMax)}
          placeholder="max, e.g. 2s"
          aria-label="Maximum duration"
        />
      </div>
    </section>
  );
}

function CollapsibleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={styles.group}>
      <button className={styles.groupHeader} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <Icon name={expanded ? 'angle-down' : 'angle-right'} size="sm" />
        {label}
      </button>
      {expanded && children}
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  sidebar: css({
    display: 'flex',
    flexDirection: 'column',
    width: 240,
    flexShrink: 0,
    borderRight: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.5, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  title: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  tabs: css({
    display: 'flex',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  tab: css({
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75),
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': { color: theme.colors.text.primary },
  }),
  tabActive: css({
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75),
    border: 'none',
    borderBottom: `2px solid ${theme.colors.primary.border}`,
    background: 'transparent',
    color: theme.colors.text.primary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  body: css({
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: theme.spacing(1),
  }),
  rowOutOfScope: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.25, 0),
    cursor: 'pointer',
    opacity: 0.4,
  }),
  groupHeaderStatic: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  durationRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),
  group: css({
    marginBottom: theme.spacing(1),
  }),
  groupHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: theme.spacing(0.5, 0),
    cursor: 'pointer',
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  groupCount: css({
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightRegular,
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(0.25, 0),
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  dot: css({
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  }),
  value: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  count: css({
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  errorsOnly: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1, 0),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  empty: css({
    margin: 0,
    padding: theme.spacing(0.5, 0),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
