import React, { useRef } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { formatDurationMs } from '../utils/formatDuration';
import { useTimelineRulerMarks } from '../utils/timelineRuler';
import type { TraceSpan } from '../types';

interface SpanDurationProps {
  span: TraceSpan;
  minMs: number;
  maxMs: number;
  serviceName?: string;
  hasError?: boolean;
}

// Reds excluded so red can mean "error" anywhere it appears in the panel.
// Only light/medium colors so the dark inside-label text stays readable.
const SERVICE_PALETTE = [
  '#5794F2',
  '#73BF69',
  '#FADE2A',
  '#B877D9',
  '#FF9830',
  '#3FB1D8',
  '#8AB8FF',
  '#E6C384',
  '#A4C77E',
  '#9FB4FF',
];

export function colorForService(name: string): string {
  if (!name) {
    return SERVICE_PALETTE[0];
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SERVICE_PALETTE[h % SERVICE_PALETTE.length];
}

const ROW_HEIGHT = 22;
const BAR_HEIGHT = 10;
const MIN_INSIDE_LABEL_PCT = 18;
const LABEL_FLIP_PCT = 88;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    height: ROW_HEIGHT,
    position: 'relative',
  }),
  baseline: css({
    position: 'absolute',
    width: '100%',
    height: 1,
    top: (ROW_HEIGHT - 1) / 2,
    background: theme.colors.border.weak,
  }),
  gridLine: css({
    position: 'absolute',
    top: 0,
    height: '100%',
    width: 1,
    background: theme.colors.border.weak,
    opacity: 0.35,
  }),
  bar: css({
    position: 'absolute',
    height: BAR_HEIGHT,
    top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
    borderRadius: BAR_HEIGHT / 2,
    display: 'flex',
    alignItems: 'center',
    minWidth: 2,
    boxShadow: theme.isDark
      ? 'inset 0 -1px 0 rgba(0,0,0,0.25)'
      : 'inset 0 -1px 0 rgba(0,0,0,0.12)',
  }),
  barError: css({
    outline: `2px solid ${theme.colors.error.main}`,
    outlineOffset: 1,
    backgroundImage: `repeating-linear-gradient(
      45deg,
      rgba(0,0,0,0) 0 4px,
      rgba(0,0,0,0.25) 4px 6px
    )`,
  }),
  errorBadge: css({
    position: 'absolute',
    top: (ROW_HEIGHT - 14) / 2,
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: theme.colors.error.main,
    color: theme.colors.error.contrastText,
    fontSize: 10,
    fontWeight: 700,
    lineHeight: '14px',
    textAlign: 'center',
    boxShadow: `0 0 0 1px ${theme.colors.background.primary}`,
    pointerEvents: 'none',
  }),
  labelInside: css({
    fontSize: 11,
    fontFamily: theme.typography.fontFamilyMonospace,
    lineHeight: `${BAR_HEIGHT}px`,
    fontWeight: 600,
    color: '#0B0F1A',
    padding: '0 6px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  labelOutside: css({
    position: 'absolute',
    top: 0,
    height: ROW_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  }),
});

export function SpanDuration({ span, minMs, maxMs, serviceName, hasError }: SpanDurationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styles = useStyles2(getStyles);
  const fullDuration = maxMs - minMs;
  const marks = useTimelineRulerMarks(containerRef, fullDuration);

  const pLeft = fullDuration > 0 ? ((span.startTime - minMs) / fullDuration) * 100 : 0;
  const pRight = fullDuration > 0 ? ((maxMs - (span.startTime + span.duration)) / fullDuration) * 100 : 0;
  const pWidth = Math.max(0.1, 100 - pLeft - pRight);

  const baseColor = colorForService(serviceName ?? '');
  const labelText = formatDurationMs(span.duration);
  const showLabelInside = pWidth >= MIN_INSIDE_LABEL_PCT;
  const outsideRight = pLeft + pWidth;
  const labelOnLeft = outsideRight > LABEL_FLIP_PCT;

  return (
    <div className={styles.container} ref={containerRef}>
      {marks.slice(1, -1).map((mark) => (
        <div
          key={mark.position}
          className={styles.gridLine}
          style={{ left: `${mark.position}%` }}
        />
      ))}
      <div className={styles.baseline} />
      <div
        className={`${styles.bar} ${hasError ? styles.barError : ''}`}
        style={{ left: `${pLeft}%`, width: `${pWidth}%`, background: baseColor }}
        title={`${labelText} • start +${formatDurationMs(span.startTime - minMs)}${hasError ? ' • ERROR' : ''}`}
      >
        {showLabelInside && <span className={styles.labelInside}>{labelText}</span>}
      </div>
      {hasError && (
        <span
          className={styles.errorBadge}
          style={{ left: `calc(${pLeft}% - 8px)` }}
          title="Span has error=true"
          aria-label="error"
        >
          !
        </span>
      )}
      {!showLabelInside && (
        <span
          className={styles.labelOutside}
          style={
            labelOnLeft
              ? { right: `calc(${100 - pLeft}% + 6px)` }
              : { left: `calc(${outsideRight}% + 6px)` }
          }
        >
          {labelText}
        </span>
      )}
    </div>
  );
}
