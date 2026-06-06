import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, IconButton, Select, useStyles2 } from '@grafana/ui';

import { DataSource } from '../datasource';
import { notifyError } from '../notify';

interface Props {
  datasource: DataSource;
  tags: string;
  serviceName?: string;
  onChange: (tags: string) => void;
  onBlur: () => void;
}

interface Tag {
  key: string;
  value: string;
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  pillRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap',
  }),
  pill: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)} ${theme.spacing(0.25)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  addRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  }),
  selectKey: css({
    minWidth: 220,
    flex: '1 1 220px',
  }),
  selectValue: css({
    minWidth: 180,
    flex: '1 1 180px',
  }),
});

function parseTags(raw: string): Tag[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(/\s+/)
    .map((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) {
        return { key: pair, value: '' };
      }
      return { key: pair.slice(0, idx), value: pair.slice(idx + 1) };
    })
    .filter((t) => t.key);
}

function serializeTags(tags: Tag[]): string {
  return tags.map((t) => `${t.key}=${t.value}`).join(' ');
}

function toOptions(values: string[]): Array<SelectableValue<string>> {
  return values.map((v) => ({ label: v, value: v }));
}

export function TagsInput({ datasource, tags, serviceName, onChange, onBlur }: Props) {
  const styles = useStyles2(getStyles);
  const parsed = parseTags(tags);

  const [selectedKey, setSelectedKey] = useState<SelectableValue<string> | null>(null);
  const [selectedValue, setSelectedValue] = useState<SelectableValue<string> | null>(null);

  const [keyOptions, setKeyOptions] = useState<Array<SelectableValue<string>>>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  const [valueOptions, setValueOptions] = useState<Array<SelectableValue<string>>>([]);
  const [valuesLoading, setValuesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setKeysLoading(true);
    setSelectedKey(null);
    setSelectedValue(null);
    setValueOptions([]);
    datasource
      .getFieldNames(serviceName)
      .then((names) => {
        if (!cancelled) {
          setKeyOptions(toOptions(names));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setKeyOptions([]);
          notifyError('Failed to load tag keys', err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setKeysLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource, serviceName]);

  useEffect(() => {
    const key = selectedKey?.value;
    if (!key) {
      setValueOptions([]);
      return;
    }
    let cancelled = false;
    setValuesLoading(true);
    setSelectedValue(null);
    datasource
      .getFieldValues(key, 100, serviceName)
      .then((values) => {
        if (!cancelled) {
          setValueOptions(toOptions(values.filter((v) => v !== '')));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setValueOptions([]);
          notifyError(`Failed to load values for ${key}`, err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setValuesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource, serviceName, selectedKey]);

  const onAddTag = useCallback(() => {
    const key = selectedKey?.value;
    const value = selectedValue?.value;
    if (!key || !value) {
      return;
    }
    onChange(serializeTags([...parsed, { key, value }]));
    setSelectedKey(null);
    setSelectedValue(null);
    onBlur();
  }, [selectedKey, selectedValue, parsed, onChange, onBlur]);

  const onRemoveTag = useCallback(
    (index: number) => {
      onChange(serializeTags(parsed.filter((_, i) => i !== index)));
      onBlur();
    },
    [parsed, onChange, onBlur]
  );

  return (
    <div className={styles.wrapper}>
      {parsed.length > 0 && (
        <div className={styles.pillRow}>
          {parsed.map((tag, i) => (
            <span key={`${tag.key}-${i}`} className={styles.pill}>
              <strong>{tag.key}</strong>={tag.value}
              <IconButton name="times" size="xs" tooltip="Remove tag" onClick={() => onRemoveTag(i)} />
            </span>
          ))}
        </div>
      )}

      <div className={styles.addRow}>
        <div className={styles.selectKey}>
          <Select
            options={keyOptions}
            value={selectedKey}
            onChange={setSelectedKey}
            placeholder="Tag key"
            isClearable
            isLoading={keysLoading}
            allowCustomValue
            noOptionsMessage="No tag keys found"
          />
        </div>
        <div className={styles.selectValue}>
          <Select
            options={valueOptions}
            value={selectedValue}
            onChange={setSelectedValue}
            placeholder={selectedKey ? 'Tag value' : 'Select key first'}
            isClearable
            isLoading={valuesLoading}
            disabled={!selectedKey}
            allowCustomValue
            noOptionsMessage={selectedKey ? 'No values found (type to add custom)' : 'Select a key first'}
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={onAddTag}
          disabled={!selectedKey?.value || !selectedValue?.value}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
