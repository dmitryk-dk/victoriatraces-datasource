import React, { useState } from "react";
import { GrafanaTheme2, SelectableValue } from "@grafana/data";
import {
  Button,
  Field,
  Input,
  RadioButtonGroup,
  Select,
  useStyles2,
} from "@grafana/ui";
import { css } from "@emotion/css";

import {
  FILTER_OPERATORS,
  type FilterMode,
  type FilterOperator,
} from "../filters/fieldFilter";
import type { FieldKeyOption } from "../filters/tagKeys";
import {
  SPAN_TYPE_PRESETS,
  SpanTypeId,
  TraceFilter,
  TraceFilterKind,
} from "../filters/types";

interface Props {
  kind: TraceFilterKind;
  /** Existing filter when editing; absent when adding a new one. */
  filter?: TraceFilter;
  operations: string[];
  tagKeys: string[];
  /** Field choices: read as a bare name, filtered on the storage name. */
  fieldKeys: FieldKeyOption[];
  tagValues: string[];
  /** Told which key is selected so the parent can fetch its values. */
  onTagKeyChange: (key: string) => void;
  onApply: (filter: TraceFilter) => void;
  /** Absent while a filter is still being added — there is nothing to remove. */
  onRemove?: () => void;
  onCancel: () => void;
}

/**
 * Editor for one filter, opened from its badge. Each kind needs different
 * inputs, so the shell owns layout and submission and the body switches on the
 * kind. Initial state comes from the filter being edited, so reopening a badge
 * shows its current values rather than a blank form.
 */
export function FilterForm({
  kind,
  filter,
  operations,
  tagKeys,
  fieldKeys,
  tagValues,
  onTagKeyChange,
  onApply,
  onRemove,
  onCancel,
}: Props) {
  const styles = useStyles2(getStyles);

  const [operation, setOperation] = useState(
    filter?.kind === "operation" ? filter.value : "",
  );
  const [tagKey, setTagKey] = useState(
    filter?.kind === "tag" ? filter.key : "",
  );
  const [tagValue, setTagValue] = useState(
    filter?.kind === "tag" ? filter.value : "",
  );
  const [min, setMin] = useState(initialMin(filter));
  const [max, setMax] = useState(initialMax(filter));
  const [spanType, setSpanType] = useState<SpanTypeId>(
    filter?.kind === "spanType" ? filter.value : "http",
  );
  const [limit, setLimit] = useState(
    filter?.kind === "limit" ? String(filter.value) : "50",
  );

  // Field-filter state, mirroring visum's Field / Custom / All modes.
  const [mode, setMode] = useState<FilterMode>(
    filter?.kind === "field" ? filter.mode : "field",
  );
  const [fieldName, setFieldName] = useState(
    filter?.kind === "field" && filter.mode === "field" ? filter.field : "",
  );
  const [operator, setOperator] = useState<FilterOperator>(
    filter?.kind === "field" && filter.mode === "field"
      ? filter.operator
      : "equals",
  );
  const [fieldValue, setFieldValue] = useState(
    filter?.kind === "field" && filter.mode === "field" ? filter.value : "",
  );
  const [customExpr, setCustomExpr] = useState(
    filter?.kind === "field" && filter.mode === "custom" ? filter.expr : "",
  );

  const operatorMeta = FILTER_OPERATORS.find((o) => o.id === operator);
  const needsValue = operatorMeta?.needsValue !== false;

  // Undefined means "no bound", which is not the same as a bound of zero. A
  // negative or unparseable count is not a bound at all.
  const toNumber = (v: string) => {
    if (v.trim() === "") {
      return undefined;
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  const build = (): TraceFilter | undefined => {
    switch (kind) {
      case "operation":
        return operation ? { kind, value: operation } : undefined;
      case "tag":
        return tagKey && tagValue
          ? { kind, key: tagKey, value: tagValue }
          : undefined;
      case "duration":
        return min || max
          ? { kind, min: min || undefined, max: max || undefined }
          : undefined;
      case "error":
        return { kind };
      case "spans": {
        const lo = toNumber(min);
        const hi = toNumber(max);
        if (Number.isNaN(lo) || Number.isNaN(hi)) {
          return undefined;
        }
        return lo !== undefined || hi !== undefined
          ? { kind, min: lo, max: hi }
          : undefined;
      }
      case "spanType":
        return { kind, value: spanType };
      case "limit": {
        const value = Number(limit);
        return Number.isFinite(value) && value > 0
          ? { kind, value }
          : undefined;
      }
      case "field": {
        if (mode === "all") {
          return { kind, mode };
        }
        if (mode === "custom") {
          return customExpr.trim()
            ? { kind, mode, expr: customExpr }
            : undefined;
        }
        if (!fieldName || (needsValue && !fieldValue)) {
          return undefined;
        }
        return { kind, mode, field: fieldName, operator, value: fieldValue };
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = build();
    if (next) {
      onApply(next);
    }
  };

  const options = (values: string[]): Array<SelectableValue<string>> =>
    values.map((v) => ({ label: v, value: v }));

  return (
    <form className={styles.form} onSubmit={submit}>
      {kind === "operation" && (
        <Field label="Operation" className={styles.field}>
          <Select
            menuShouldPortal={false}
            menuPosition="absolute"
            options={options(operations)}
            value={operation || null}
            onChange={(v) => setOperation(v?.value ?? "")}
            placeholder={
              operations.length > 0
                ? "Select an operation"
                : "Select a service first"
            }
            allowCustomValue
            width={32}
            autoFocus
          />
        </Field>
      )}

      {kind === "tag" && (
        <>
          <Field label="Key" className={styles.field}>
            <Select
              menuShouldPortal={false}
              menuPosition="absolute"
              options={options(tagKeys)}
              value={tagKey || null}
              onChange={(v) => {
                const next = v?.value ?? "";
                setTagKey(next);
                // Values are key-scoped, so clear the old one and load the new set.
                setTagValue("");
                onTagKeyChange(next);
              }}
              placeholder="Tag key"
              allowCustomValue
              width={28}
              autoFocus
            />
          </Field>
          <Field label="Value" className={styles.field}>
            <Select
              menuShouldPortal={false}
              menuPosition="absolute"
              options={options(tagValues)}
              value={tagValue || null}
              onChange={(v) => setTagValue(v?.value ?? "")}
              placeholder={tagKey ? "Any value" : "Pick a key first"}
              allowCustomValue
              width={28}
            />
          </Field>
        </>
      )}

      {kind === "duration" && (
        <>
          <Field label="Min" description="e.g. 250ms" className={styles.field}>
            <Input
              value={min}
              onChange={(e) => setMin(e.currentTarget.value)}
              placeholder="250ms"
              width={14}
              autoFocus
            />
          </Field>
          <Field label="Max" className={styles.field}>
            <Input
              value={max}
              onChange={(e) => setMax(e.currentTarget.value)}
              placeholder="2s"
              width={14}
            />
          </Field>
        </>
      )}

      {kind === "spans" && (
        <>
          <Field label="Min" className={styles.field}>
            <Input
              type="number"
              value={min}
              onChange={(e) => setMin(e.currentTarget.value)}
              width={12}
              autoFocus
            />
          </Field>
          <Field label="Max" className={styles.field}>
            <Input
              type="number"
              value={max}
              onChange={(e) => setMax(e.currentTarget.value)}
              width={12}
            />
          </Field>
        </>
      )}

      {kind === "spanType" && (
        <Field label="Span type" className={styles.field}>
          <Select
            menuShouldPortal={false}
            menuPosition="absolute"
            options={SPAN_TYPE_PRESETS.map((p) => ({
              label: p.label,
              value: p.id,
            }))}
            value={spanType}
            onChange={(v) => setSpanType((v?.value as SpanTypeId) ?? "http")}
            width={28}
          />
        </Field>
      )}

      {kind === "limit" && (
        <Field label="Limit" className={styles.field}>
          <Input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.currentTarget.value)}
            width={12}
            autoFocus
          />
        </Field>
      )}

      {kind === "field" && (
        <div className={styles.fieldFilter}>
          <RadioButtonGroup
            options={[
              { label: "Field", value: "field" as FilterMode },
              { label: "Custom", value: "custom" as FilterMode },
              { label: "All", value: "all" as FilterMode },
            ]}
            value={mode}
            onChange={setMode}
            size="sm"
          />

          {mode === "field" && (
            <div className={styles.fieldRow}>
              <Field label="Field" className={styles.field}>
                <Select
                  menuShouldPortal={false}
                  menuPosition="absolute"
                  options={fieldKeys}
                  value={fieldName || null}
                  onChange={(v) => setFieldName(v?.value ?? "")}
                  placeholder="Select a field for filtering…"
                  allowCustomValue
                  width={30}
                />
              </Field>
              <Field label="Operator" className={styles.field}>
                <Select
                  menuShouldPortal={false}
                  menuPosition="absolute"
                  options={FILTER_OPERATORS.map((o) => ({
                    label: o.label,
                    value: o.id,
                    description: o.description,
                  }))}
                  value={operator}
                  onChange={(v) =>
                    setOperator((v?.value as FilterOperator) ?? "equals")
                  }
                  width={26}
                />
              </Field>
              {needsValue && (
                <Field label="Value" className={styles.field}>
                  <Select
                    menuShouldPortal={false}
                    menuPosition="absolute"
                    options={options(tagValues)}
                    value={fieldValue || null}
                    onChange={(v) => setFieldValue(v?.value ?? "")}
                    placeholder="Type a filter value…"
                    allowCustomValue
                    width={26}
                  />
                </Field>
              )}
            </div>
          )}

          {mode === "custom" && (
            <Field
              label="Expression"
              description="Raw LogsQL, used as written"
              className={styles.field}
            >
              <Input
                value={customExpr}
                onChange={(e) => setCustomExpr(e.currentTarget.value)}
                placeholder="e.g. status_code:2"
                width={60}
              />
            </Field>
          )}

          {mode === "all" && (
            <span className={styles.note}>
              Matches everything — no condition applied.
            </span>
          )}
        </div>
      )}

      {kind === "error" && (
        <span className={styles.note}>
          Only traces containing an errored span.
        </span>
      )}

      <div className={styles.actions}>
        <Button type="submit" size="sm" disabled={!build()}>
          Apply
        </Button>
        {onRemove && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            fill="outline"
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function initialMin(filter?: TraceFilter): string {
  if (filter?.kind === "duration") {
    return filter.min ?? "";
  }
  if (filter?.kind === "spans") {
    return filter.min !== undefined ? String(filter.min) : "";
  }
  return "";
}

function initialMax(filter?: TraceFilter): string {
  if (filter?.kind === "duration") {
    return filter.max ?? "";
  }
  if (filter?.kind === "spans") {
    return filter.max !== undefined ? String(filter.max) : "";
  }
  return "";
}

const getStyles = (theme: GrafanaTheme2) => ({
  form: css({
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
  }),
  field: css({
    margin: 0,
  }),
  actions: css({
    display: "flex",
    gap: theme.spacing(1),
    paddingBottom: theme.spacing(0.5),
  }),
  fieldFilter: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(1),
  }),
  fieldRow: css({
    display: "flex",
    alignItems: "flex-end",
    gap: theme.spacing(1),
    flexWrap: "wrap",
  }),
  note: css({
    color: theme.colors.text.secondary,
    paddingBottom: theme.spacing(1),
  }),
});
