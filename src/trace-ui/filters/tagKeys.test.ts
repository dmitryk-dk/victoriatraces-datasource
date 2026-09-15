import { fieldKeyOptions, isHiddenTagKey, normalizeTagKey } from './tagKeys';

describe('normalizeTagKey', () => {
  it('strips the storage prefix', () => {
    expect(normalizeTagKey('span_attr:http.route')).toBe('http.route');
    expect(normalizeTagKey('resource_attr:host.name')).toBe('host.name');
  });

  it('leaves a core field alone', () => {
    expect(normalizeTagKey('duration')).toBe('duration');
  });
});

const field = (value: string, hits = 0) => ({ value, hits });

describe('fieldKeyOptions', () => {
  it('keeps the storage name as the value so the filter matches something', () => {
    // The bare name is what the user reads; only the prefixed name exists in
    // storage, so filtering on the bare one matches nothing.
    expect(fieldKeyOptions([field('span_attr:http.route', 12)])).toEqual([
      { label: 'http.route', value: 'span_attr:http.route', description: 'span_attr · 12 spans' },
    ]);
  });

  it('distinguishes the same name under two prefixes', () => {
    const options = fieldKeyOptions([field('span_attr:host.name', 2), field('resource_attr:host.name', 1)]);
    expect(options.map((o) => o.value)).toEqual(['span_attr:host.name', 'resource_attr:host.name']);
    expect(options.map((o) => o.description)).toEqual(['span_attr · 2 spans', 'resource_attr · 1 span']);
  });

  it('describes an unprefixed field as a core field', () => {
    expect(fieldKeyOptions([field('error')])).toEqual([
      { label: 'error', value: 'error', description: 'core field' },
    ]);
  });

  it('drops storage internals and fields with their own control', () => {
    expect(
      fieldKeyOptions([field('trace_id'), field('span_attr:service.name'), field('duration')])
    ).toEqual([]);
  });

  it('offers the most common keys first', () => {
    // Alphabetical order buries the keys most traces actually carry.
    const options = fieldKeyOptions([field('span_attr:a.rare', 3), field('span_attr:z.common', 900)]);
    expect(options.map((o) => o.label)).toEqual(['z.common', 'a.rare']);
  });

  it('falls back to the name when nothing has hits', () => {
    const options = fieldKeyOptions([field('span_attr:z.last'), field('resource_attr:a.first')]);
    expect(options.map((o) => o.label)).toEqual(['a.first', 'z.last']);
  });
});

describe('isHiddenTagKey', () => {
  it('hides a prefixed field whose bare name is hidden', () => {
    expect(isHiddenTagKey('resource_attr:service.name')).toBe(true);
  });
});
