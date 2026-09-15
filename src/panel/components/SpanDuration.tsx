import React, { useMemo, useRef } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { formatDurationMs } from '../utils/formatDuration';
import { colorForService } from '../utils/serviceColor';
import { useTimelineRulerMarks } from '../utils/timelineRuler';
import type { TraceSpan } from '../types';
import type { CriticalSegment } from '../../trace-logic/criticalPath';

interface SpanDurationProps {
  span: TraceSpan;
  minMs: number;
  maxMs: number;
  serviceName?: string;
  hasError?: boolean;
  /** This span's segments on the trace's critical path, in ms. */
  criticalSegments?: readonly CriticalSegment[];
}

export { colorForService } from '../utils/serviceColor';

const ROW_HEIGHT = 22;
const BAR_HEIGHT = 10;
const MIN_INSIDE_LABEL_PCT = 18;

// Narrowest a span bar may be drawn, as a percentage of the trace's width.
const MIN_BAR_PCT = 0.5;
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
  criticalOverlay: css({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    height: BAR_HEIGHT,
    // Clipped to the bar so a band can never render outside its span.
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 2,
  }),
  criticalBand: css({
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    height: 2,
    minWidth: 2,
    pointerEvents: 'auto',
    // Reserved for the critical path, distinct from the service palette (which
    // excludes reds) and from the error styling.
    background: theme.colors.text.maxContrast,
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

export function SpanDuration({
  span,
  minMs,
  maxMs,
  serviceName,
  hasError,
  criticalSegments,
}: SpanDurationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styles = useStyles2(getStyles);
  const fullDuration = maxMs - minMs;
  const marks = useTimelineRulerMarks(containerRef, fullDuration);

  const pLeft = fullDuration > 0 ? ((span.startTime - minMs) / fullDuration) * 100 : 0;
  const pRight = fullDuration > 0 ? ((maxMs - (span.startTime + span.duration)) / fullDuration) * 100 : 0;
  // A floor: a span thousands of times shorter than the trace still has
  // to be wide enough to see and to hover.
  const pWidth = Math.max(MIN_BAR_PCT, 100 - pLeft - pRight);

  // Bands are positioned within this span's own bar rather than the whole
  // timeline, so the overlay is clipped to the bar and a minimum-width sliver
  // cannot spill past its edge.
  const criticalBands = useMemo(() => {
    if (!criticalSegments?.length || span.duration <= 0) {
      return [];
    }
    return criticalSegments
      .map((seg) => {
        const left = Math.max(0, ((seg.start - span.startTime) / span.duration) * 100);
        const right = Math.min(100, ((seg.end - span.startTime) / span.duration) * 100);
        return { left, width: right - left };
      })
      .filter((band) => band.width > 0);
  }, [criticalSegments, span.startTime, span.duration]);

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
      {criticalBands.length > 0 && (
        <div
          className={styles.criticalOverlay}
          style={{ left: `${pLeft}%`, width: `${pWidth}%` }}
        >
          {criticalBands.map((band, i) => (
            <span
              key={`critical-${i}`}
              className={styles.criticalBand}
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
              title="On the critical path — this segment gated the trace's duration"
            />
          ))}
        </div>
      )}
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
