import React, { useMemo, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import type { TraceSpan } from '../../panel/types';

const PREVIEW_COUNT = 5;

/** Where an attribute came from, which is what the grouping communicates. */
type AttributeGroup = 'span' | 'resource' | 'meta';

interface Attribute {
  key: string;
  value: string;
  group: AttributeGroup;
}

const GROUP_LABELS: Record<AttributeGroup, string> = {
  span: 'Span',
  resource: 'Resource',
  meta: 'Meta',
};

const META_KEYS = new Set(['span.kind', 'otel.status_code', 'otel.scope.name', 'otel.scope.version', 'error']);

function groupFor(key: string): AttributeGroup {
  if (META_KEYS.has(key)) {
    return 'meta';
  }
  // Resource attributes describe the emitting process rather than the operation.
  if (key.startsWith('service.') || key.startsWith('k8s.') || key.startsWith('host.') || key.startsWith('process.')) {
    return 'resource';
  }
  return 'span';
}

interface Props {
  /** Root span of the previewed trace. */
  span?: TraceSpan;
  loading: boolean;
}

/**
 * Attributes of the trace's root span, grouped by origin.
 *
 * Shows the first few and expands in place: a span can carry dozens, and the
 * preview panel is a summary, not a full span inspector.
 */
export function AttributesSection({ span, loading }: Props) {
  const styles = useStyles2(getStyles);
  const [showAll, setShowAll] = useState(false);

  const attributes = useMemo<Attribute[]>(() => {
    if (!span) {
      return [];
    }
    return span.tags
      .map((tag) => ({
        key: tag.key,
        value: tag.value === undefined || tag.value === null ? '' : String(tag.value),
        group: groupFor(tag.key),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [span]);

  const visible = showAll ? attributes : attributes.slice(0, PREVIEW_COUNT);
  const hiddenCount = attributes.length - visible.length;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <span className={styles.title}>Attributes</span>
        {attributes.length > 0 && <span className={styles.badge}>{attributes.length}</span>}
      </div>

      <div className={styles.body}>
        {loading && attributes.length === 0 && <LoadingPlaceholder text="Loading attributes…" />}

        {!loading && attributes.length === 0 && (
          <p className={styles.empty}>No attributes on this trace&apos;s root span.</p>
        )}

        {visible.map((attr) => (
          <div key={`${attr.group}:${attr.key}`} className={styles.row}>
            <div className={styles.key}>
              {attr.key}
              <span className={styles.group}>{GROUP_LABELS[attr.group]}</span>
            </div>
            <div className={styles.value}>
              {attr.value === '' ? <span className={styles.emptyValue}>Empty string</span> : attr.value}
            </div>
          </div>
        ))}

        {(hiddenCount > 0 || showAll) && (
          <Button variant="secondary" fill="text" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `${hiddenCount} more attribute${hiddenCount === 1 ? '' : 's'}`}
            <Icon name={showAll ? 'angle-up' : 'angle-down'} />
          </Button>
        )}
      </div>
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  title: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  badge: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
  body: css({
    padding: theme.spacing(1),
  }),
  row: css({
    padding: theme.spacing(0.5, 0),
    '& + &': { borderTop: `1px solid ${theme.colors.border.weak}` },
  }),
  key: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  group: css({
    flexShrink: 0,
    color: theme.colors.text.disabled,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  value: css({
    fontSize: theme.typography.bodySmall.fontSize,
    wordBreak: 'break-all',
  }),
  emptyValue: css({
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  empty: css({
    margin: 0,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
