import type { TraceFilter } from './types';

/**
 * A tag key can only be filtered once.
 *
 * Tag conditions are ANDed, so two equality filters on one key match nothing.
 * visum keeps tags in a `Record<key, value>`, where setting a key overwrites
 * it; this is the same rule against a list.
 */
function sameTagKey(a: TraceFilter, b: TraceFilter): boolean {
  return a.kind === 'tag' && b.kind === 'tag' && a.key === b.key;
}

/** Adds a filter, replacing an existing tag on the same key in place. */
export function appendFilter(filters: readonly TraceFilter[], next: TraceFilter): TraceFilter[] {
  const existing = filters.findIndex((f) => sameTagKey(f, next));
  if (existing === -1) {
    return [...filters, next];
  }
  return filters.map((f, i) => (i === existing ? next : f));
}

/** Replaces the filter at `index`, dropping any other tag it now collides with. */
export function applyFilterAt(
  filters: readonly TraceFilter[],
  index: number,
  next: TraceFilter
): TraceFilter[] {
  return filters
    .map((f, i) => (i === index ? next : f))
    .filter((f, i) => i === index || !sameTagKey(f, next));
}
