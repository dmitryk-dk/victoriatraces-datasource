import { useEffect, useMemo, useState } from 'react';

const MIN_MARK_SPACING_PX = 80;

export interface TimelineMark {
  position: number; // 0-100 percentage
  valueMs: number; // value in ms
}

export interface LabelledMark extends TimelineMark {
  label: string;
}

/**
 * Rounds a raw step up to 1, 2, 5 or 10 times a power of ten, so ticks read as
 * "100ms" rather than "142ms".
 */
export function niceTimeStep(raw: number): number {
  if (raw <= 0) {
    return 1;
  }
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * pow;
}

/**
 * Ruler marks across a span, stepping by a round increment and always closing
 * on the full duration. A round tick within half a step of the end is dropped,
 * so the last two labels do not overlap.
 */
export function rulerMarks(widthPx: number, totalDurationMs: number): TimelineMark[] {
  if (totalDurationMs <= 0 || widthPx <= 0) {
    return [{ valueMs: 0, position: 0 }];
  }

  const targetTicks = Math.max(1, Math.floor(widthPx / MIN_MARK_SPACING_PX));
  const step = niceTimeStep(totalDurationMs / targetTicks);

  const marks: TimelineMark[] = [{ valueMs: 0, position: 0 }];
  for (let value = step; value < totalDurationMs - step * 0.5; value += step) {
    marks.push({ valueMs: value, position: (value / totalDurationMs) * 100 });
  }
  marks.push({ valueMs: totalDurationMs, position: 100 });
  return marks;
}

/**
 * Labels the marks and drops consecutive repeats: at a coarse duration format
 * several neighbouring ticks can render the same text, which reads as a
 * rendering fault. The last mark always survives, since it carries the span.
 */
export function collapseDuplicateLabels(
  marks: readonly TimelineMark[],
  format: (valueMs: number) => string
): LabelledMark[] {
  const out: LabelledMark[] = [];
  marks.forEach((mark, index) => {
    const label = format(mark.valueMs);
    const isLast = index === marks.length - 1;
    if (isLast) {
      while (out.length > 0 && out[out.length - 1].label === label) {
        out.pop();
      }
      out.push({ ...mark, label });
    } else if (out.length === 0 || out[out.length - 1].label !== label) {
      out.push({ ...mark, label });
    }
  });
  return out;
}

/**
 * Ruler marks for a container, recomputed when it is resized.
 */
export function useTimelineRulerMarks(
  containerRef: React.RefObject<HTMLElement | null>,
  totalDurationMs: number
): TimelineMark[] {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [containerRef]);

  return useMemo(() => rulerMarks(width, totalDurationMs), [width, totalDurationMs]);
}
