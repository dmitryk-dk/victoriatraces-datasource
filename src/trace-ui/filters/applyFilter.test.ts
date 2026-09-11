import { applyFilterAt, appendFilter } from './applyFilter';
import type { TraceFilter } from './types';

const tag = (key: string, value: string): TraceFilter => ({ kind: 'tag', key, value });

describe('appendFilter', () => {
  it('adds a tag on a key not filtered yet', () => {
    expect(appendFilter([tag('http.method', 'GET')], tag('http.route', '/'))).toEqual([
      tag('http.method', 'GET'),
      tag('http.route', '/'),
    ]);
  });

  it('replaces the existing tag on the same key', () => {
    // Two equality filters on one key are ANDed and match nothing; visum keeps
    // tags in a map, where a key can only be set once.
    expect(appendFilter([tag('http.method', 'GET')], tag('http.method', 'POST'))).toEqual([
      tag('http.method', 'POST'),
    ]);
  });

  it('keeps the position of the tag it replaces', () => {
    const filters = [tag('a', '1'), tag('b', '2'), tag('c', '3')];
    expect(appendFilter(filters, tag('b', 'changed')).map((f) => f.kind === 'tag' && f.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('appends other kinds without merging', () => {
    const filters: TraceFilter[] = [{ kind: 'field', mode: 'all' }];
    expect(appendFilter(filters, { kind: 'field', mode: 'all' })).toHaveLength(2);
  });
});

describe('applyFilterAt', () => {
  it('replaces the filter being edited', () => {
    const filters = [tag('a', '1'), tag('b', '2')];
    expect(applyFilterAt(filters, 1, tag('b', 'changed'))).toEqual([tag('a', '1'), tag('b', 'changed')]);
  });

  it('absorbs another tag when an edit collides with its key', () => {
    const filters = [tag('a', '1'), tag('b', '2')];
    expect(applyFilterAt(filters, 1, tag('a', 'changed'))).toEqual([tag('a', 'changed')]);
  });
});
