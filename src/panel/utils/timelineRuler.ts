import { useEffect, useMemo, useState } from 'react';

const MIN_MARK_SPACING_PX = 80;

export interface TimelineMark {
  position: number; // 0-100 percentage
  valueMs: number;  // value in ms
}

/**
 * Calculates evenly-spaced ruler marks for a timeline of given total duration.
 * Recalculates whenever the container element is resized.
 */
export function useTimelineRulerMarks(
  containerRef: React.RefObject<HTMLElement | null>,
  totalDurationMs: number
): TimelineMark[] {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [containerRef]);

  return useMemo(() => {
    if (totalDurationMs <= 0) {
      return [
        { position: 0, valueMs: 0 },
        { position: 100, valueMs: 0 },
      ];
    }
    const markCount = Math.max(2, Math.floor(width / MIN_MARK_SPACING_PX));
    return Array.from({ length: markCount }, (_, i) => ({
      position: (i / (markCount - 1)) * 100,
      valueMs: (i / (markCount - 1)) * totalDurationMs,
    }));
  }, [width, totalDurationMs]);
}
