import { completionsFor, docFor } from './completions';

describe('completionsFor', () => {
  it('offers pipes, and only pipes, after a pipe character', () => {
    const items = completionsFor({ kind: 'pipe', word: 'sta' }, { fields: [], values: [] });
    const labels = items.map((i) => i.label);

    expect(labels).toContain('stats');
    expect(labels.every((l) => !l.includes(':'))).toBe(true);
  });

  it('explains what each suggestion does', () => {
    // The docs panel beside the suggestion is the whole point: it is what
    // tells you the difference between `stats` and `block_stats`.
    const [stats] = completionsFor({ kind: 'pipe', word: 'stats' }, { fields: [], values: [] }).filter(
      (i) => i.label === 'stats'
    );

    expect(stats.detail).toBeTruthy();
    expect(stats.documentation).toContain('stats');
  });

  it('offers the fields the datasource reported', () => {
    const items = completionsFor(
      { kind: 'field', word: 'ser' },
      { fields: ['service.name', 'span.name'], values: [] }
    );

    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(['service.name', 'span.name']));
  });

  it('offers the values of the field being filtered', () => {
    const items = completionsFor(
      { kind: 'fieldValue', field: 'service.name', word: 'fro' },
      { fields: [], values: ['frontend', 'cart'] }
    );

    expect(items.map((i) => i.label)).toEqual(['frontend', 'cart']);
    expect(items[0].detail).toBe('service.name');
  });

  it('offers filters, keywords and fields at the opening position', () => {
    const labels = completionsFor(
      { kind: 'filterOrField', word: '' },
      { fields: ['service.name'], values: [] }
    ).map((i) => i.label);

    expect(labels).toContain('service.name');
    expect(labels).toContain('_time');
    expect(labels).toContain('AND');
  });

  it('never suggests the same label twice', () => {
    // `_time` is both a special field and a reported one.
    const labels = completionsFor(
      { kind: 'filterOrField', word: '' },
      { fields: ['_time', '_msg'], values: [] }
    ).map((i) => i.label);

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('docFor', () => {
  it('explains a term under the cursor', () => {
    expect(docFor('stats')?.documentation).toContain('stats');
  });

  it('says nothing about a word it does not know', () => {
    expect(docFor('checkout')).toBeUndefined();
  });
});
