/** One span attribute, as the trace frames carry it. */
export interface SpanField {
  key: string;
  value: unknown;
}

export interface SpanFieldGroup {
  /** The dotted namespace: "http", "db", or "other" for unprefixed fields. */
  prefix: string;
  fields: SpanField[];
}

const UNPREFIXED = 'other';

/**
 * Span attributes grouped by their dotted namespace and filtered by a search
 * string.
 *
 * A span can carry dozens of attributes; grouped by namespace they can be
 * skimmed, and the search covers values as well as names because "which field
 * held this id" is as common a question as "what is http.route".
 */
export function groupSpanFields(fields: readonly SpanField[], search: string): SpanFieldGroup[] {
  const needle = search.trim().toLowerCase();
  const matching = needle
    ? fields.filter(
        (f) =>
          f.key.toLowerCase().includes(needle) ||
          String(f.value ?? '')
            .toLowerCase()
            .includes(needle)
      )
    : [...fields];

  const byPrefix = new Map<string, SpanField[]>();
  for (const field of matching) {
    const dot = field.key.indexOf('.');
    const prefix = dot > 0 ? field.key.slice(0, dot) : UNPREFIXED;
    const bucket = byPrefix.get(prefix);
    if (bucket) {
      bucket.push(field);
    } else {
      byPrefix.set(prefix, [field]);
    }
  }

  return [...byPrefix.entries()]
    .map(([prefix, groupFields]) => ({
      prefix,
      fields: [...groupFields].sort((a, b) => a.key.localeCompare(b.key)),
    }))
    // Namespaces alphabetically, with the unprefixed leftovers last.
    .sort((a, b) => {
      if (a.prefix === UNPREFIXED) {
        return 1;
      }
      if (b.prefix === UNPREFIXED) {
        return -1;
      }
      return a.prefix.localeCompare(b.prefix);
    });
}
