import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { serviceColor } from '../utils/format';

const CHIP_GAP_PX = 4;

interface Props {
  services: readonly string[];
}

/**
 * Renders as many service chips as fit on one line, collapsing the rest into a
 * "+N" chip. Widths are measured from a hidden twin because the chips are
 * text-sized, so the count that fits is only knowable after layout.
 */
export function ServiceChips({ services }: Props) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(services.length);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) {
      return;
    }
    const available = container.clientWidth;
    const chips = Array.from(measure.children) as HTMLElement[];
    // The last measured child is the widest the "+N" chip can get.
    const plusWidth = chips[chips.length - 1]?.offsetWidth ?? 0;
    const widths = chips.slice(0, -1).map((c) => c.offsetWidth);

    const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP_PX : 0), 0);
    if (total <= available) {
      setVisibleCount(widths.length);
      return;
    }

    let used = plusWidth;
    let count = 0;
    for (const w of widths) {
      if (used + CHIP_GAP_PX + w > available) {
        break;
      }
      used += CHIP_GAP_PX + w;
      count++;
    }
    setVisibleCount(Math.max(1, count));
  }, []);

  useLayoutEffect(() => {
    recompute();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [recompute, services]);

  const hidden = services.length - visibleCount;

  return (
    <div ref={containerRef} className={styles.container}>
      <div ref={measureRef} aria-hidden="true" className={styles.measure}>
        {services.map((s) => (
          <Chip key={s} service={s} />
        ))}
        <span className={styles.overflow}>+{services.length}</span>
      </div>

      <div className={styles.row}>
        {services.slice(0, visibleCount).map((s) => (
          <Chip key={s} service={s} />
        ))}
        {hidden > 0 && (
          <Tooltip content={<span>{services.slice(visibleCount).join(', ')}</span>} placement="top">
            <span className={styles.overflow}>+{hidden}</span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function Chip({ service }: { service: string }) {
  const styles = useStyles2(getStyles);
  return (
    <span className={styles.chip}>
      <span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: serviceColor(service) }} />
      {service}
    </span>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    position: 'relative',
    minWidth: 0,
  }),
  measure: css({
    position: 'absolute',
    display: 'flex',
    visibility: 'hidden',
    pointerEvents: 'none',
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    overflow: 'hidden',
  }),
  chip: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    whiteSpace: 'nowrap',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    padding: theme.spacing(0, 0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.6,
  }),
  swatch: css({
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 1,
  }),
  overflow: css({
    flexShrink: 0,
    whiteSpace: 'nowrap',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    padding: theme.spacing(0, 0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.6,
    cursor: 'default',
  }),
});
