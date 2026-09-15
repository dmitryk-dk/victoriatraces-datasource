import React, { useMemo, useState } from 'react';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Dropdown, FilterInput, Icon, IconButton, Menu, Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { isHiddenTagKey } from '../filters/tagKeys';
import { COMMON_FIELDS, traceFieldLabel } from '../filters/traceFields';
import { columnsForEntity } from './traceColumns';

interface Props {
  traceCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  hiddenColumns: ReadonlySet<string>;
  onToggleColumn: (key: string) => void;
  /** Extra span fields shown as columns. */
  customFields: readonly string[];
  onCustomFieldsChange: (fields: string[]) => void;
  /** Field names offered by the picker, from the datasource. */
  availableFields: readonly string[];
  entity: 'traces' | 'spans';
  /** Provided only while the sidebar is hidden, to bring it back. */
  onShowFilters?: () => void;
}

export function TracesListToolbar({
  traceCount,
  search,
  onSearchChange,
  hiddenColumns,
  onToggleColumn,
  customFields,
  onCustomFieldsChange,
  availableFields,
  entity,
  onShowFilters,
}: Props) {
  const styles = useStyles2(getStyles);
  const [adding, setAdding] = useState(false);

  const columns = columnsForEntity(entity);
  // Hiding the last column would leave an empty table.
  const visibleCount = columns.filter((c) => !hiddenColumns.has(c.key)).length;

  const fieldOptions: Array<SelectableValue<string>> = useMemo(() => {
    // Offer the well-known fields first, then whatever this datasource reports,
    // minus storage internals and anything already added.
    const discovered = availableFields.filter((f) => !isHiddenTagKey(f));
    const seen = new Set(customFields);
    const ordered = [...COMMON_FIELDS, ...discovered].filter((f) => {
      if (seen.has(f)) {
        return false;
      }
      seen.add(f);
      return true;
    });
    return ordered.map((f) => ({ label: traceFieldLabel(f), value: f, description: f }));
  }, [availableFields, customFields]);

  const columnsMenu = (
    <Menu>
      {columns.map((col) => {
        const visible = !hiddenColumns.has(col.key);
        return (
          <Menu.Item
            key={col.key}
            label={col.label}
            icon={visible ? 'check' : undefined}
            disabled={visible && visibleCount === 1}
            onClick={() => onToggleColumn(col.key)}
          />
        );
      })}
    </Menu>
  );

  return (
    <div className={styles.toolbar}>
      {onShowFilters && (
        <Button variant="secondary" size="sm" icon="filter" onClick={onShowFilters}>
          Filters
        </Button>
      )}

      <span className={styles.count}>
        {traceCount} {entity === 'spans' ? (traceCount === 1 ? 'span' : 'spans') : traceCount === 1 ? 'trace' : 'traces'}
      </span>

      {customFields.map((field) => (
        <span key={field} className={styles.fieldChip}>
          <Icon name="columns" size="sm" className={styles.chipIcon} />
          {traceFieldLabel(field)}
          <IconButton
            name="times"
            size="sm"
            tooltip={`Remove ${traceFieldLabel(field)} column`}
            aria-label={`Remove ${traceFieldLabel(field)} column`}
            onClick={() => onCustomFieldsChange(customFields.filter((f) => f !== field))}
          />
        </span>
      ))}

      {adding ? (
        <Select
          options={fieldOptions}
          value={null}
          onChange={(v) => {
            if (v?.value) {
              onCustomFieldsChange([...customFields, v.value]);
            }
            setAdding(false);
          }}
          onBlur={() => setAdding(false)}
          placeholder="Span field to add as a column"
          allowCustomValue
          autoFocus
          openMenuOnFocus
          width={36}
          aria-label="Add column"
        />
      ) : (
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>
          Add column
        </Button>
      )}

      <FilterInput value={search} onChange={onSearchChange} placeholder="Filter loaded traces" width={28} />

      <Dropdown overlay={columnsMenu} placement="bottom-end">
        <Button variant="secondary" size="sm" icon="columns">
          Columns
        </Button>
      </Dropdown>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
    flexShrink: 0,
    paddingBottom: theme.spacing(1),
  }),
  count: css({
    marginRight: 'auto',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
  fieldChip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0.5, 0.25, 1),
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap',
  }),
  chipIcon: css({
    color: theme.colors.text.secondary,
  }),
});
