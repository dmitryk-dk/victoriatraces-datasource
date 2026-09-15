import React, { useMemo, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, LoadingPlaceholder, Select, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { OperationStat } from '../api/traceList';
import { formatMicros, serviceColor } from '../utils/format';

type SortKey = 'operation' | 'spans' | 'avgDurationMicros' | 'errors';
type SortDir = 'asc' | 'desc';

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'operation', label: 'Operation', numeric: false },
  { key: 'spans', label: 'Spans', numeric: true },
  { key: 'avgDurationMicros', label: 'Avg duration', numeric: true },
  { key: 'errors', label: 'Errors', numeric: true },
];

interface Props {
  services: string[];
  service?: string;
  onServiceChange: (service: string) => void;
  stats: OperationStat[];
  /** The backend capped the list; what is shown is not all of it. */
  truncated?: boolean;
  loading: boolean;
  error?: Error;
  onSelectOperation?: (operation: string) => void;
}

/**
 * Per-operation breakdown for one service: which operations run most, which are
 * slowest, which fail. Clicking a row filters the trace list to it.
 */
export function OperationsOverview({
  services,
  service,
  onServiceChange,
  stats,
  truncated,
  loading,
  error,
  onSelectOperation,
}: Props) {
  const styles = useStyles2(getStyles);
  const [sortKey, setSortKey] = useState<SortKey>('spans');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1;
    return [...stats].sort((a, b) =>
      sortKey === 'operation'
        ? factor * a.operation.localeCompare(b.operation)
        : factor * (a[sortKey] - b[sortKey])
    );
  }, [stats, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Counts and durations are read largest-first; names read A–Z.
      setSortDir(key === 'operation' ? 'asc' : 'desc');
    }
  };

  const maxSpans = useMemo(() => Math.max(...stats.map((s) => s.spans), 1), [stats]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <Select
          options={services.map((s) => ({ label: s, value: s }))}
          value={service ?? null}
          onChange={(v) => onServiceChange(v?.value ?? '')}
          placeholder="Select a service"
          width={32}
          aria-label="Service"
        />
        {service && <span className={styles.dot} style={{ background: serviceColor(service) }} />}
        {truncated && (
          <span className={styles.truncated}>
            Showing only the busiest operations — this service has more than fit here.
          </span>
        )}
      </div>

      {!service && <div className={styles.empty}>Pick a service to see its operations.</div>}

      {error && (
        <Alert title="Could not load operations" severity="warning">
          {error.message}
        </Alert>
      )}

      {service && loading && stats.length === 0 && <LoadingPlaceholder text="Loading operations…" />}

      {service && !loading && !error && stats.length === 0 && (
        <div className={styles.empty}>No operations for this service in the selected range.</div>
      )}

      {stats.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={col.numeric ? styles.thNumeric : styles.th}>
                    <button type="button" className={styles.sortBtn} onClick={() => toggleSort(col.key)}>
                      {col.label}
                      {sortKey === col.key && (
                        <Icon name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'} size="sm" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((stat) => (
                <tr
                  key={stat.operation}
                  className={onSelectOperation ? styles.rowClickable : styles.row}
                  onClick={() => onSelectOperation?.(stat.operation)}
                  title={onSelectOperation ? 'Filter traces by this operation' : undefined}
                >
                  <td className={styles.td} title={stat.operation}>
                    {stat.operation}
                  </td>
                  <td className={styles.tdNumeric}>
                    <span
                      aria-hidden="true"
                      className={styles.bar}
                      style={{ width: `${(stat.spans / maxSpans) * 100}%` }}
                    />
                    <span className={styles.value}>{stat.spans}</span>
                  </td>
                  <td className={styles.tdNumeric}>{formatMicros(stat.avgDurationMicros)}</td>
                  <td className={stat.errors > 0 ? styles.tdError : styles.tdNumeric}>{stat.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  truncated: css({
    marginLeft: 'auto',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  wrap: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    flex: 1,
    minHeight: 0,
  }),
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  dot: css({
    width: 10,
    height: 10,
    borderRadius: '50%',
  }),
  scroll: css({
    // Takes the height the panel leaves it and scrolls inside, rather than
    // showing a 220px window with empty panel below it.
    flex: 1,
    minHeight: 120,
    overflow: 'auto',
  }),
  table: css({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      textAlign: 'left',
      padding: theme.spacing(0.5, 1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    },
  }),
  th: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.primary,
    whiteSpace: 'nowrap',
  }),
  thNumeric: css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: theme.colors.background.primary,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  }),
  sortBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: 'inherit',
    '&:hover': { color: theme.colors.text.primary },
  }),
  row: css({}),
  rowClickable: css({
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  td: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 0,
  }),
  tdNumeric: css({
    position: 'relative',
    overflow: 'hidden',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }),
  tdError: css({
    position: 'relative',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    color: theme.colors.error.text,
  }),
  bar: css({
    position: 'absolute',
    insetBlock: 0,
    left: 0,
    background: theme.colors.background.secondary,
  }),
  value: css({
    position: 'relative',
  }),
  empty: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
