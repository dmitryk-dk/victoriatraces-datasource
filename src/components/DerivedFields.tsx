import React, { useCallback } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { DerivedFieldConfig } from '../types';
import { DerivedField } from './DerivedField';

type Props = {
  fields?: DerivedFieldConfig[];
  onChange: (fields: DerivedFieldConfig[]) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  heading: css({ fontSize: theme.typography.h4.fontSize, fontWeight: theme.typography.fontWeightMedium, marginBottom: theme.spacing(0.5) }),
  description: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize, marginBottom: theme.spacing(2) }),
  field: css({ marginBottom: theme.spacing(2), padding: theme.spacing(1.5), border: `1px solid ${theme.colors.border.weak}`, borderRadius: theme.shape.radius.default }),
});

export function DerivedFields({ fields = [], onChange }: Props) {
  const styles = useStyles2(getStyles);

  const validateName = useCallback(
    (name: string) => fields.filter((f) => f.name && f.name === name).length <= 1,
    [fields]
  );

  const update = (index: number, newField: DerivedFieldConfig) => {
    const next = [...fields];
    next.splice(index, 1, newField);
    onChange(next);
  };

  const remove = (index: number) => {
    const next = [...fields];
    next.splice(index, 1);
    onChange(next);
  };

  const add = () => {
    onChange([
      ...fields,
      { name: '', matcherRegex: '', matcherType: 'label', url: '${__value.raw}', urlDisplayLabel: 'View Trace' },
    ]);
  };

  return (
    <div>
      <p className={styles.heading}>Derived fields</p>
      <p className={styles.description}>
        Extract a value from each log/span record and turn it into a clickable link — e.g. extract{' '}
        <code>traceID</code> and link to VictoriaTraces or Jaeger to jump straight to the trace.
      </p>

      {fields.map((field, i) => (
        <div key={i} className={styles.field}>
          <DerivedField
            value={field}
            onChange={(updated) => update(i, updated)}
            onDelete={() => remove(i)}
            validateName={validateName}
          />
        </div>
      ))}

      <Button variant="secondary" icon="plus" onClick={(e) => { e.preventDefault(); add(); }}>
        Add derived field
      </Button>
    </div>
  );
}
