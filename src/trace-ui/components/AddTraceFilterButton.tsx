import React from 'react';
import { Button, Dropdown, Menu } from '@grafana/ui';

import {
  FILTER_DESCRIPTIONS,
  FILTER_ICONS,
  FILTER_LABELS,
  SPAN_TYPE_PRESETS,
  SpanTypeId,
  TraceFilterKind,
} from '../filters/types';

// Order follows visum: the filters reached for most often come first, and span
// type sits apart because it picks a preset rather than opening a form.
const KIND_ORDER: TraceFilterKind[] = ['field', 'tag', 'operation', 'duration', 'spans', 'error', 'limit'];

interface Props {
  onAdd: (kind: TraceFilterKind) => void;
  onAddSpanType: (id: SpanTypeId) => void;
  activeSpanType?: SpanTypeId;
  disabledKinds?: ReadonlySet<TraceFilterKind>;
}

export function AddTraceFilterButton({ onAdd, onAddSpanType, activeSpanType, disabledKinds }: Props) {
  const menu = (
    <Menu>
      {KIND_ORDER.filter((kind) => !disabledKinds?.has(kind)).map((kind) => (
        <Menu.Item
          key={kind}
          label={FILTER_LABELS[kind]}
          description={FILTER_DESCRIPTIONS[kind]}
          icon={FILTER_ICONS[kind]}
          onClick={() => onAdd(kind)}
        />
      ))}

      <Menu.Divider />

      <Menu.Item
        label={FILTER_LABELS.spanType}
        description={FILTER_DESCRIPTIONS.spanType}
        icon={FILTER_ICONS.spanType}
        childItems={SPAN_TYPE_PRESETS.map((preset) => (
          <Menu.Item
            key={preset.id}
            label={preset.label}
            // A tick marks the preset already applied, so the submenu doubles
            // as a display of the current span-type filter.
            icon={activeSpanType === preset.id ? 'check' : undefined}
            onClick={() => onAddSpanType(preset.id)}
          />
        ))}
      />
    </Menu>
  );

  return (
    <Dropdown overlay={menu} placement="bottom-start">
      <Button variant="secondary" icon="plus" size="sm">
        Add filter
      </Button>
    </Dropdown>
  );
}
