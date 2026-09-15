import React, { useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { ClickOutsideWrapper, Icon, Popover, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { FILTER_ICONS, FILTER_LABELS, summarizeFilter, TraceFilter } from '../filters/types';
import type { FieldKeyOption } from '../filters/tagKeys';
import { FilterForm } from './FilterForms';

// Error and span-type carry their whole meaning in the badge itself, so there
// is nothing to reopen; every other kind has values worth changing in place.
function isEditable(filter: TraceFilter): boolean {
  return filter.kind !== 'error' && filter.kind !== 'spanType';
}

interface Props {
  filter: TraceFilter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (next: TraceFilter) => void;
  onRemove: () => void;
  operations: string[];
  tagKeys: string[];
  fieldKeys: FieldKeyOption[];
  /** Values for the tag key currently being edited. */
  tagValues: string[];
  onTagKeyChange: (key: string) => void;
}

/**
 * A filter as an editable pill: the body reopens the form to change values, the
 * trailing × removes it. The badge is where filters are
 * edited rather than in a separate panel.
 */
export function TraceFilterBadge({
  filter,
  open,
  onOpenChange,
  onApply,
  onRemove,
  operations,
  tagKeys,
  fieldKeys,
  tagValues,
  onTagKeyChange,
}: Props) {
  const styles = useStyles2(getStyles);
  const [reference, setReference] = useState<HTMLElement | null>(null);
  const label = FILTER_LABELS[filter.kind];
  const summary = summarizeFilter(filter);
  const editable = isEditable(filter);

  const apply = (next: TraceFilter) => {
    onApply(next);
    onOpenChange(false);
  };

  return (
    <>
      <span className={styles.badge} ref={setReference}>
        <button
          type="button"
          className={editable ? styles.body : styles.bodyStatic}
          onClick={editable ? () => onOpenChange(!open) : undefined}
          aria-label={editable ? `Edit ${label} filter` : undefined}
          aria-expanded={editable ? open : undefined}
        >
          <Icon name={FILTER_ICONS[filter.kind]} size="sm" className={styles.icon} />
          <span className={styles.label}>{label}</span>
          {summary !== label.toLowerCase() && (
            <>
              <span className={styles.label}>:</span>
              <span className={styles.value}>{summary}</span>
            </>
          )}
        </button>

        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`Remove ${label} filter`}
          title="Remove filter"
        >
          <Icon name="times" size="sm" />
        </button>
      </span>

      {reference && editable && (
        <Popover
          show={open}
          placement="bottom-start"
          referenceElement={reference}
          content={
            <ClickOutsideWrapper onClick={() => onOpenChange(false)} useCapture>
              <div className={styles.popover}>
                <FilterForm
                  kind={filter.kind}
                  filter={filter}
                  operations={operations}
                  tagKeys={tagKeys}
                  fieldKeys={fieldKeys}
                  tagValues={tagValues}
                  onTagKeyChange={onTagKeyChange}
                  onApply={apply}
                  onRemove={onRemove}
                  onCancel={() => onOpenChange(false)}
                />
              </div>
            </ClickOutsideWrapper>
          }
        />
      )}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  badge: css({
    display: 'inline-flex',
    alignItems: 'stretch',
    height: theme.spacing(3.5),
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  body: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0, 1),
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': { background: theme.colors.action.hover },
  }),
  bodyStatic: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0, 1),
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    cursor: 'default',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  icon: css({
    color: theme.colors.text.secondary,
  }),
  label: css({
    color: theme.colors.text.secondary,
  }),
  value: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    whiteSpace: 'nowrap',
  }),
  remove: css({
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0, 0.75),
    border: 'none',
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    background: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.error.transparent,
      color: theme.colors.error.text,
    },
  }),
  popover: css({
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    zIndex: theme.zIndex.dropdown,
  }),
});
