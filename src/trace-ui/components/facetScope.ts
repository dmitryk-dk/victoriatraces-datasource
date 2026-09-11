import type { FacetValue } from '../api/traceList';

/** A facet value plus whether the other active filters still allow it. */
export interface ScopedFacetValue extends FacetValue {
  inScope: boolean;
}

/**
 * Marks which values would still return traces under the filters already set
 * elsewhere, as visum's sidebar does.
 *
 * The count shown stays the unscoped one. Counts that shrink as you select
 * turn the sidebar into a dead end — a value drops to zero and disappears
 * before you can tell whether it would have combined with your other choices —
 * so the count describes the range and the dimming describes the combination.
 */
export function scopeFacetValues(
  universe: readonly FacetValue[],
  scoped: readonly FacetValue[] | undefined
): ScopedFacetValue[] {
  if (!scoped) {
    return universe.map((value) => ({ ...value, inScope: true }));
  }
  const allowed = new Set(scoped.map((v) => v.value));
  return universe.map((value) => ({ ...value, inScope: allowed.has(value.value) }));
}

/**
 * Selected values first so a choice never scrolls out of reach, then what the
 * other filters allow, then the rest — each group busiest first.
 */
export function orderFacetValues(
  values: readonly ScopedFacetValue[],
  selected: ReadonlySet<string>
): ScopedFacetValue[] {
  const rank = (v: ScopedFacetValue) => (selected.has(v.value) ? 0 : v.inScope ? 1 : 2);
  return [...values].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.value.localeCompare(b.value));
}
