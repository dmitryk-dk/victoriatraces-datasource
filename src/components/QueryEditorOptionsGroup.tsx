import { css } from '@emotion/css';
import React, { useState } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';

interface Props {
  title: string;
  collapsedInfo: string[];
  children: React.ReactNode;
}

const QueryEditorOptionsGroup: React.FC<Props> = ({ title, children, collapsedInfo }) => {
  const [isOpen, setIsOpen] = useState(false);
  const styles = useStyles2(getStyles);

  return (
    <div>
      <div className={styles.header} onClick={() => setIsOpen((v) => !v)} title="Click to edit options">
        <div className={styles.toggle}>
          <Icon name={isOpen ? 'angle-down' : 'angle-right'} />
        </div>
        <h6 className={styles.title}>{title}</h6>
        {!isOpen && (
          <div className={styles.description}>
            {collapsedInfo.map((x, i) => (
              <span key={i}>{x}</span>
            ))}
          </div>
        )}
      </div>
      {isOpen && <div className={styles.body}>{children}</div>}
    </div>
  );
};

export default QueryEditorOptionsGroup;

const getStyles = (theme: GrafanaTheme2) => ({
  header: css({
    display: 'flex',
    cursor: 'pointer',
    alignItems: 'baseline',
    color: theme.colors.text.primary,
    '&:hover': {
      background: theme.colors.emphasize(theme.colors.background.primary, 0.03),
    },
  }),
  title: css({
    overflow: 'hidden',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    margin: 0,
  }),
  description: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    paddingLeft: theme.spacing(2),
    gap: theme.spacing(2),
    display: 'flex',
  }),
  body: css({
    display: 'flex',
    paddingTop: theme.spacing(2),
    paddingLeft: theme.spacing(1),
    gap: theme.spacing(2),
    flexWrap: 'wrap',
  }),
  toggle: css({
    color: theme.colors.text.secondary,
    marginRight: theme.spacing(1),
  }),
});
