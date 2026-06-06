import React, { ChangeEvent, useState } from 'react';
import { css } from '@emotion/css';
import { DataSourceInstanceSettings, GrafanaTheme2, DataLinkBuiltInVars } from '@grafana/data';
import { DataSourcePicker } from '@grafana/runtime';
import { Button, Field, Icon, Input, Label, Select, Switch, Tooltip, useStyles2 } from '@grafana/ui';
import { DerivedFieldConfig } from '../types';

type Props = {
  value: DerivedFieldConfig;
  onChange: (value: DerivedFieldConfig) => void;
  onDelete: () => void;
  validateName: (name: string) => boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({ display: 'flex', alignItems: 'baseline', gap: theme.spacing(0.5), flexWrap: 'wrap' }),
  nameField: css({ flex: 2, minWidth: 120 }),
  typeField: css({ flex: '0 0 160px' }),
  matcherField: css({ flex: 3, minWidth: 160 }),
  urlField: css({ flex: 3, minWidth: 160 }),
  labelField: css({ flex: 2, minWidth: 120 }),
  linkRow: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), flexWrap: 'wrap', marginTop: theme.spacing(0.5) }),
});

export function DerivedField({ value, onChange, onDelete, validateName }: Props) {
  const styles = useStyles2(getStyles);
  const [showInternalLink, setShowInternalLink] = useState(!!value.datasourceUid);
  const matcherType = value.matcherType ?? 'regex';
  const invalidName = !validateName(value.name);

  const set = (field: keyof DerivedFieldConfig) => (e: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [field]: e.currentTarget.value });

  return (
    <div>
      <div className={styles.row}>
        <Field
          className={styles.nameField}
          label="Name"
          invalid={invalidName}
          error="Name already in use"
        >
          <Input value={value.name} onChange={set('name')} placeholder="traceID" invalid={invalidName} />
        </Field>

        <Field
          className={styles.typeField}
          label={
            <TooltipLabel
              label="Type"
              tip="Extract from a label/field key, or apply a regex to the log line."
            />
          }
        >
          <Select
            options={[
              { label: 'Label', value: 'label' },
              { label: 'Regex in log line', value: 'regex' },
            ]}
            value={matcherType}
            onChange={(opt) => onChange({ ...value, matcherType: opt.value as 'label' | 'regex' })}
          />
        </Field>

        <Field
          className={styles.matcherField}
          label={
            <TooltipLabel
              label={matcherType === 'label' ? 'Label key' : 'Regex'}
              tip={
                matcherType === 'label'
                  ? 'Field name in the labels JSON, e.g. "traceID".'
                  : 'Regex with one capture group, e.g. "traceID=(\\w+)".'
              }
            />
          }
        >
          <Input
            value={value.matcherRegex}
            onChange={set('matcherRegex')}
            placeholder={matcherType === 'label' ? 'traceID' : 'traceID=(\\w+)'}
          />
        </Field>

        <Field label="">
          <Button
            aria-label="Remove derived field"
            variant="destructive"
            icon="times"
            onClick={(e) => { e.preventDefault(); onDelete(); }}
          />
        </Field>
      </div>

      <div className={styles.linkRow}>
        <Field label={showInternalLink ? 'Query / trace ID' : 'URL'} className={styles.urlField}>
          <Input
            value={value.url ?? ''}
            onChange={set('url')}
            placeholder={showInternalLink ? '${__value.raw}' : `http://example.com/\${${DataLinkBuiltInVars.valueRaw}}`}
          />
        </Field>

        <Field label="URL label" className={styles.labelField}>
          <Input
            value={value.urlDisplayLabel ?? ''}
            onChange={set('urlDisplayLabel')}
            placeholder="View Trace"
          />
        </Field>

        <Field label="Internal link">
          <Switch
            value={showInternalLink}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const checked = e.currentTarget.checked;
              if (!checked) {
                onChange({ ...value, datasourceUid: undefined });
              }
              setShowInternalLink(checked);
            }}
          />
        </Field>

        {showInternalLink && (
          <Field label="Datasource">
            <DataSourcePicker
              tracing
              current={value.datasourceUid}
              noDefault
              onChange={(ds: DataSourceInstanceSettings) =>
                onChange({ ...value, datasourceUid: ds.uid })
              }
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function TooltipLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <Label>
      {label}
      <Tooltip placement="top" content={tip} theme="info">
        <Icon name="info-circle" size="sm" style={{ marginLeft: 4 }} />
      </Tooltip>
    </Label>
  );
}
