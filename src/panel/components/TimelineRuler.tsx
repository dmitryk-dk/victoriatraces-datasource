import React, { useRef } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { formatDurationMs } from '../utils/formatDuration';
import { useTimelineRulerMarks } from '../utils/timelineRuler';

interface TimelineRulerProps {
  totalDurationMs: number;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
    height: 48,
    position: 'relative',
    fontFamily: 'monospace',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  baseline: css({
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    height: 1,
    background: theme.colors.border.weak,
  }),
  mark: css({
    position: 'absolute',
    top: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  }),
  tick: css({
    width: 1,
    height: 8,
    marginTop: 8,
    background: theme.colors.border.weak,
  }),
  label: css({
    marginTop: 4,
    whiteSpace: 'nowrap',
  }),
});

export function TimelineRuler({ totalDurationMs }: TimelineRulerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styles = useStyles2(getStyles);
  const marks = useTimelineRulerMarks(containerRef, totalDurationMs);

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.baseline} />
      {marks.map((mark, index) => {
        const isFirst = index === 0;
        const isLast = index === marks.length - 1;
        const translateX = isFirst ? '0%' : isLast ? '-100%' : '-50%';
        const alignItems = isFirst ? 'flex-start' : isLast ? 'flex-end' : 'center';
        return (
          <div
            key={mark.position}
            className={styles.mark}
            style={{ left: `${mark.position}%`, transform: `translateX(${translateX})`, alignItems }}
          >
            <div className={styles.tick} />
            <div className={styles.label}>{formatDurationMs(mark.valueMs)}</div>
          </div>
        );
      })}
    </div>
  );
}
