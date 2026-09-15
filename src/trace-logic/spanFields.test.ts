import { groupSpanFields } from './spanFields';

const tag = (key: string, value: unknown = 'v') => ({ key, value });

describe('groupSpanFields', () => {
  it('groups fields by their dotted prefix', () => {
    const groups = groupSpanFields(
      [tag('http.method'), tag('http.route'), tag('db.system')],
      ''
    );
    expect(groups.map((g) => g.prefix)).toEqual(['db', 'http']);
    expect(groups.find((g) => g.prefix === 'http')?.fields.map((f) => f.key)).toEqual([
      'http.method',
      'http.route',
    ]);
  });

  it('collects fields with no prefix under "other"', () => {
    const groups = groupSpanFields([tag('error'), tag('http.method')], '');
    expect(groups.map((g) => g.prefix)).toEqual(['http', 'other']);
    expect(groups.find((g) => g.prefix === 'other')?.fields.map((f) => f.key)).toEqual(['error']);
  });

  it('puts "other" last however the prefixes sort', () => {
    const groups = groupSpanFields([tag('error'), tag('zz.late')], '');
    expect(groups[groups.length - 1].prefix).toBe('other');
  });

  it('sorts fields within a group', () => {
    const groups = groupSpanFields([tag('http.route'), tag('http.method')], '');
    expect(groups[0].fields.map((f) => f.key)).toEqual(['http.method', 'http.route']);
  });

  it('filters on the field name', () => {
    const groups = groupSpanFields([tag('http.method'), tag('db.system')], 'db');
    expect(groups.map((g) => g.prefix)).toEqual(['db']);
  });

  it('filters on the value too', () => {
    // Finding "which field held this id" is as common as finding a field.
    const groups = groupSpanFields([tag('http.method', 'GET'), tag('db.system', 'postgres')], 'postgres');
    expect(groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual(['db.system']);
  });

  it('matches case-insensitively', () => {
    const groups = groupSpanFields([tag('http.method', 'GET')], 'get');
    expect(groups).toHaveLength(1);
  });

  it('drops a group whose fields all filtered out', () => {
    expect(groupSpanFields([tag('http.method')], 'nothing')).toEqual([]);
  });

  it('handles a span with no fields', () => {
    expect(groupSpanFields([], '')).toEqual([]);
  });
});
