import { orderFacetValues, scopeFacetValues } from './facetScope';
import type { FacetValue } from '../api/traceList';

const v = (value: string, count: number): FacetValue => ({ value, count });

describe('scopeFacetValues', () => {
  it('marks values the other filters still allow', () => {
    const universe = [v('frontend', 100), v('cart', 20)];
    const scoped = [v('frontend', 7)];

    expect(scopeFacetValues(universe, scoped)).toEqual([
      { value: 'frontend', count: 100, inScope: true },
      { value: 'cart', count: 20, inScope: false },
    ]);
  });

  it('keeps the unscoped count, so a value never appears to shrink', () => {
    // Counts that drop as you select make the sidebar unreadable; visum shows
    // the universe count and dims what would not combine.
    const [frontend] = scopeFacetValues([v('frontend', 100)], [v('frontend', 3)]);
    expect(frontend.count).toBe(100);
  });

  it('treats everything as in scope when nothing has been scoped yet', () => {
    expect(scopeFacetValues([v('frontend', 100)], undefined)).toEqual([
      { value: 'frontend', count: 100, inScope: true },
    ]);
  });

  it('marks a value absent from the scoped result as out of scope', () => {
    const [cart] = scopeFacetValues([v('cart', 20)], []);
    expect(cart.inScope).toBe(false);
  });
});

describe('orderFacetValues', () => {
  const values = [
    { value: 'cart', count: 20, inScope: false },
    { value: 'frontend', count: 100, inScope: true },
    { value: 'payments', count: 5, inScope: true },
  ];

  it('puts selected values first, whatever their count', () => {
    expect(orderFacetValues(values, new Set(['payments'])).map((x) => x.value)).toEqual([
      'payments',
      'frontend',
      'cart',
    ]);
  });

  it('puts in-scope values above out-of-scope ones', () => {
    expect(orderFacetValues(values, new Set()).map((x) => x.value)).toEqual([
      'frontend',
      'payments',
      'cart',
    ]);
  });

  it('orders by count within a group', () => {
    const sameScope = [
      { value: 'a', count: 1, inScope: true },
      { value: 'b', count: 9, inScope: true },
    ];
    expect(orderFacetValues(sameScope, new Set()).map((x) => x.value)).toEqual(['b', 'a']);
  });

  it('leaves the input untouched', () => {
    const input = [...values];
    orderFacetValues(input, new Set());
    expect(input).toEqual(values);
  });
});
