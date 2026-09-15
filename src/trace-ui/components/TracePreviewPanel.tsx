import React, { useMemo } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, IconButton, LoadingPlaceholder, Tooltip, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { TraceListRow, toSpanSummaries, useOperationDurations } from '../api/traceList';
import { toPanelTrace } from '../utils/toPanelTrace';
import { buildAutoMetricsSelector, openAutoMetricsForSpan, openLogsForSpan } from '../correlations';
import type { TraceToLogsOptions, TraceToMetricsOptions } from '../../types';
import { AttributesSection } from './AttributesSection';
import { traceLookupWindow, useTrace } from '../api/traces';
import { findCriticalSpan } from '../../trace-logic/criticalSpan';
import { buildHistogramCells, valueFraction } from '../../trace-logic/durationDistribution';
import { summarizeTrace } from '../../trace-logic/traceSummary';
import { formatMicros, serviceColor } from '../utils/format';

interface Props {
  uid?: string;
  row: TraceListRow;
  traceToLogs?: TraceToLogsOptions;
  traceToMetrics?: TraceToMetricsOptions;
  /** Page time range, RFC3339 — scopes the duration distribution sample. */
  start?: string;
  end?: string;
  onClose: () => void;
  onOpenTrace: () => void;
}

export function TracePreviewPanel({
  uid,
  row,
  start,
  end,
  traceToLogs,
  traceToMetrics,
  onClose,
  onOpenTrace,
}: Props) {
  const styles = useStyles2(getStyles);

  // Scoped to the trace's own start rather than the page range: a trace near
  // the edge of the range has spans outside it, and the upstream needs bounds.
  const lookupWindow = useMemo(() => traceLookupWindow(row.startTime), [row.startTime]);
  const { data: trace, loading, error } = useTrace(uid, row.traceID, lookupWindow);

  const spans = useMemo(() => toSpanSummaries(trace), [trace]);
  const summary = useMemo(() => summarizeTrace(spans), [spans]);
  const criticalSpan = useMemo(() => findCriticalSpan(spans), [spans]);

  // A trace's duration is its root span's duration, so the distribution it is
  // compared against must be root spans only — reused operation names would
  // otherwise drag in unrelated child spans.
  const durations = useOperationDurations(uid, row.rootService, row.rootOperation, true, start, end);

  // Correlations act on the root span: it is what the row represents, and its
  // attributes carry the trace-level context (service, route, status).
  const panelTrace = useMemo(() => (trace ? toPanelTrace(trace) : undefined), [trace]);
  const rootSpan = useMemo(
    () => panelTrace?.spans.find((s) => !s.references.some((r) => r.refType === 'CHILD_OF')),
    [panelTrace]
  );

  const hasLogs = Boolean(traceToLogs?.datasourceUid);
  const hasMetrics = Boolean(
    traceToMetrics?.datasourceUid && rootSpan && buildAutoMetricsSelector(traceToMetrics, panelTrace, rootSpan)
  );

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.panelTitle}>Trace Preview</span>
        <IconButton
          name="copy"
          tooltip="Copy trace ID"
          aria-label="Copy trace ID"
          onClick={() => navigator.clipboard?.writeText(row.traceID).catch(() => {})}
        />
        {hasLogs && rootSpan && (
          <IconButton
            name="file-alt"
            tooltip="Open logs for this trace"
            aria-label="Open logs for this trace"
            onClick={() => openLogsForSpan(traceToLogs, panelTrace, rootSpan)}
          />
        )}
        {hasMetrics && rootSpan && (
          <IconButton
            name="chart-line"
            tooltip="Open metrics for this trace"
            aria-label="Open metrics for this trace"
            onClick={() => openAutoMetricsForSpan(traceToMetrics, panelTrace, rootSpan)}
          />
        )}
        <IconButton name="eye" tooltip="Open full trace view" aria-label="Open full trace view" onClick={onOpenTrace} />
        <IconButton name="times" tooltip="Close preview" aria-label="Close preview" onClick={onClose} />
      </header>

      <dl className={styles.summary}>
        <dt>ID</dt>
        <dd className={styles.summaryId} title={row.traceID}>
          {row.traceID}
        </dd>

        <dt>Root Service</dt>
        <dd className={styles.summaryService}>
          <span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: serviceColor(row.rootService) }} />
          {row.rootService}
        </dd>

        <dt>Root Operation</dt>
        <dd>{row.rootOperation}</dd>

        <dt>Spans</dt>
        <dd className={styles.rowValue}>{row.spans || spans.length}</dd>
      </dl>

      <Button variant="secondary" icon="share-alt" onClick={onOpenTrace} fullWidth>
        Open full trace view
      </Button>

      {error && (
        <Alert title="Could not load trace" severity="error">
          {error.message}
        </Alert>
      )}

      <DurationSection
        durations={durations.data ?? []}
        loading={durations.loading}
        valueMicros={row.durationMicros}
      />

      <Section title="Critical span">
        {loading && <LoadingPlaceholder text="Loading spans…" />}
        {!loading && !criticalSpan && <p className={styles.emptyText}>No spans found for this trace.</p>}
        {criticalSpan && (
          <div className={styles.row}>
            <span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: serviceColor(criticalSpan.span.service) }} />
            <span className={styles.rowLabel}>
              <strong>{criticalSpan.span.service}</strong> · {criticalSpan.span.operation}
            </span>
            <span className={styles.rowValue}>{formatMicros(criticalSpan.criticalMicros)}</span>
          </div>
        )}
      </Section>

      <Section title="Services" badge={summary.services.length || undefined}>
        {loading && summary.services.length === 0 && <LoadingPlaceholder text="Loading spans…" />}
        {!loading && summary.services.length === 0 && <p className={styles.emptyText}>No spans found for this trace.</p>}
        {summary.services.map((service, index) => (
          <div key={service.service} className={styles.row}>
            <span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: serviceColor(service.service) }} />
            <span className={styles.rowLabel}>{service.service}</span>
            {/* The list is sorted by self time, so the first row is the slowest. */}
            {index === 0 && summary.services.length > 1 && <span className={styles.tag}>LONGEST</span>}
            <span className={styles.rowCount}>
              {service.spanCount} {service.spanCount === 1 ? 'span' : 'spans'}
            </span>
            <span className={styles.rowValue}>{formatMicros(service.selfMicros)}</span>
          </div>
        ))}
      </Section>

      <AttributesSection span={rootSpan} loading={loading} />

      <Section title="Errors" badge={summary.errors.length || undefined} badgeTone="error">
        {loading && <LoadingPlaceholder text="Loading spans…" />}
        {!loading && summary.errors.length === 0 && <p className={styles.emptyText}>No errors in this trace.</p>}
        {summary.errors.map((err, i) => (
          <div key={`${err.service}-${err.operation}-${i}`} className={styles.row}>
            <span className={styles.offset}>+{formatMicros(err.offsetMicros)}</span>
            <span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: serviceColor(err.service) }} />
            <span className={styles.rowLabel}>
              <strong>{err.service}</strong> · {err.operation}
            </span>
          </div>
        ))}
      </Section>
    </aside>
  );
}

interface DurationSectionProps {
  durations: number[];
  loading: boolean;
  valueMicros: number;
}

/**
 * Density strip of how long this operation usually takes, with a marker for
 * this trace. Tone is relative to the median, so one fast outlier can't paint
 * the typical case red.
 */
function DurationSection({ durations, loading, valueMicros }: DurationSectionProps) {
  const styles = useStyles2(getStyles);
  const cells = useMemo(() => buildHistogramCells(durations), [durations]);
  const markerPct = useMemo(() => valueFraction(durations, valueMicros) * 100, [durations, valueMicros]);

  return (
    <Section title="Duration" badge={durations.length || undefined}>
      <div className={styles.durationValue}>{formatMicros(valueMicros)}</div>

      {loading && durations.length === 0 && <LoadingPlaceholder text="Loading distribution…" />}

      {!loading && durations.length === 0 && (
        <p className={styles.emptyText}>No comparable durations in this time range.</p>
      )}

      {cells.length > 0 && (
        <div className={styles.strip}>
          {cells.map((cell, i) => (
            <Tooltip
              key={i}
              content={
                <span>
                  {formatMicros(cell.fromMicros)}–{formatMicros(cell.toMicros)}: {cell.count}
                </span>
              }
            >
              <span
                className={styles.cell}
                style={{
                  background: toneColor(cell.tone),
                  opacity: cell.count === 0 ? 0.12 : 0.25 + 0.75 * cell.intensity,
                }}
              />
            </Tooltip>
          ))}
          <span aria-hidden="true" className={styles.marker} style={{ left: `${markerPct}%` }} />
        </div>
      )}
    </Section>
  );
}

// The tones are semantic (fast / slower than typical / far slower), so they map
// onto the theme's status colours rather than raw hex.
function toneColor(tone: 'green' | 'yellow' | 'red'): string {
  switch (tone) {
    case 'red':
      return 'var(--vt-tone-red)';
    case 'yellow':
      return 'var(--vt-tone-yellow)';
    default:
      return 'var(--vt-tone-green)';
  }
}

interface SectionProps {
  title: string;
  badge?: number;
  badgeTone?: 'neutral' | 'error';
  children: React.ReactNode;
}

function Section({ title, badge, badgeTone = 'neutral', children }: SectionProps) {
  const styles = useStyles2(getStyles);
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>{title}</span>
        {badge !== undefined && (
          <span className={badgeTone === 'error' ? styles.badgeError : styles.badge}>{badge}</span>
        )}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    // Tone tokens are declared once here so the histogram cells can be plain
    // spans without threading the theme through every cell.
    '--vt-tone-green': theme.visualization.getColorByName('green'),
    '--vt-tone-yellow': theme.visualization.getColorByName('yellow'),
    '--vt-tone-red': theme.visualization.getColorByName('red'),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    width: 360,
    flexShrink: 0,
    overflowY: 'auto',
    padding: theme.spacing(1),
    borderLeft: `1px solid ${theme.colors.border.weak}`,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  panelTitle: css({
    flex: 1,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  summary: css({
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: theme.spacing(0.25, 1),
    margin: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    'dt': { color: theme.colors.text.secondary },
    'dd': { margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }),
  summaryId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  summaryService: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  tag: css({
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    letterSpacing: '0.04em',
  }),
  traceId: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  section: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  sectionTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  sectionBody: css({
    padding: theme.spacing(1),
  }),
  badge: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontVariantNumeric: 'tabular-nums',
  }),
  badgeError: css({
    background: theme.colors.error.transparent,
    color: theme.colors.error.text,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0, 0.75),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0),
    fontSize: theme.typography.bodySmall.fontSize,
    '& + &': { borderTop: `1px solid ${theme.colors.border.weak}` },
  }),
  rowLabel: css({
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  rowCount: css({
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  rowValue: css({
    fontVariantNumeric: 'tabular-nums',
  }),
  offset: css({
    width: 64,
    flexShrink: 0,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontVariantNumeric: 'tabular-nums',
  }),
  swatch: css({
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: 2,
  }),
  durationValue: css({
    fontSize: theme.typography.h4.fontSize,
    fontVariantNumeric: 'tabular-nums',
    marginBottom: theme.spacing(1),
  }),
  strip: css({
    position: 'relative',
    display: 'flex',
    gap: 1,
    height: 28,
  }),
  cell: css({
    flex: 1,
    borderRadius: 1,
  }),
  marker: css({
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 2,
    background: theme.colors.text.primary,
    transform: 'translateX(-1px)',
  }),
  emptyText: css({
    margin: 0,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
