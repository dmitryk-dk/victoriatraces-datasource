// VictoriaTraces exposes span data through LogsQL with these storage prefixes.
// A tag filter should match the attribute by its bare name, so the prefix is
// stripped when a key comes out of the autocomplete.
const STORAGE_PREFIXES = ['resource_attr:', 'span_attr:'] as const;

export function normalizeTagKey(field: string): string {
  for (const prefix of STORAGE_PREFIXES) {
    if (field.startsWith(prefix)) {
      return field.slice(prefix.length);
    }
  }
  return field;
}

// Fields that must never be offered as tag keys: `service.name` and the
// operation name have first-class controls, and the rest are VictoriaTraces or
// OTLP storage internals that make no sense as a tag filter.
export const TRACE_TAG_HIDE_LIST: ReadonlySet<string> = new Set([
  '_time',
  '_msg',
  '_stream',
  '_stream_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'trace_state',
  'flags',
  'kind',
  'start_time_unix_nano',
  'end_time_unix_nano',
  'end_time',
  'duration',
  'service.name',
  'operation',
  'name',
  'scope_name',
  'scope_version',
  'status_code',
  'status_message',
  'dropped_attributes_count',
  'dropped_events_count',
  'dropped_links_count',
]);

export function isHiddenTagKey(field: string): boolean {
  return TRACE_TAG_HIDE_LIST.has(normalizeTagKey(field));
}

/** A field name as the backend reports it, with how many spans carry it. */
export interface FieldName {
  value: string;
  hits: number;
}

/** One selectable field: read as its bare name, filtered on its storage name. */
export interface FieldKeyOption {
  label: string;
  value: string;
  description: string;
}

/**
 * Field choices for the Field filter, as visum's key picker builds them: the
 * bare name is shown, the storage name is what the filter carries. A filter on
 * the bare name matches nothing, because only the prefixed field exists.
 */
export function fieldKeyOptions(names: readonly FieldName[]): FieldKeyOption[] {
  const seen = new Set<string>();
  const options: Array<FieldKeyOption & { hits: number }> = [];
  for (const { value, hits } of names) {
    if (isHiddenTagKey(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const prefix = STORAGE_PREFIXES.find((p) => value.startsWith(p));
    const where = prefix ? prefix.slice(0, -1) : 'core field';
    options.push({
      label: normalizeTagKey(value),
      value,
      // The count is how a reader tells a key most spans carry from one a
      // handful do, which is what visum's picker shows.
      description: hits > 0 ? `${where} · ${hits} ${hits === 1 ? 'span' : 'spans'}` : where,
      hits,
    });
  }
  // Most-used first, as visum's key picker orders them; the name breaks ties
  // so a list with no counts at all stays alphabetical.
  options.sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return options.map(({ hits: _hits, ...option }) => option);
}
