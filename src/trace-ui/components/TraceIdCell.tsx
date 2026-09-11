import React, { useEffect, useRef, useState } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

interface Props {
  traceId: string;
}

/**
 * Trace id with a copy button that appears on hover.
 *
 * The id is longer than its column, so on hover the cell lifts out over its
 * neighbours to show the whole value rather than truncating it.
 */
export function TraceIdCell({ traceId }: Props) {
  const styles = useStyles2(getStyles);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = (e: React.MouseEvent) => {
    // The row opens the preview; copying should not.
    e.stopPropagation();
    navigator.clipboard?.writeText(traceId).then(
      () => {
        setCopied(true);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      },
      () => {}
    );
  };

  // The reveal is keyed off this wrapper rather than the row, so crossing the
  // Duration or Services cells does not pop the id out over its neighbours.
  return (
    <span className={`${styles.wrap} trace-id-cell`}>
      <span className={styles.truncated}>{traceId}</span>
      <span className={styles.expanded}>
        {traceId}
        <IconButton
          name={copied ? 'check' : 'copy'}
          size="sm"
          tooltip={copied ? 'Copied' : 'Copy trace ID'}
          aria-label="Copy trace ID"
          onClick={copy}
        />
      </span>
    </span>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    position: 'relative',
    display: 'block',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  truncated: css({
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '.trace-id-cell:hover &': { opacity: 0 },
  }),
  expanded: css({
    position: 'absolute',
    top: '50%',
    left: 0,
    transform: 'translateY(-50%)',
    zIndex: 2,
    display: 'none',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    whiteSpace: 'nowrap',
    padding: theme.spacing(0.25, 0.5),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.elevated,
    boxShadow: theme.shadows.z2,
    '.trace-id-cell:hover &': { display: 'flex' },
  }),
});
