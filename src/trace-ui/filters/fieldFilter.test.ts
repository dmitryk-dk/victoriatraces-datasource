import {
  FILTER_OPERATORS,
  quoteFieldIdentifier,
  quoteString,
  serializeFieldCondition,
} from './fieldFilter';

// These assertions pin the output to what visum's serializer produces, so the
// two products build identical LogsQL from the same filter.

describe('quoteString', () => {
  it('escapes backslashes before quotes', () => {
    expect(quoteString('a"b')).toBe('"a\\"b"');
    expect(quoteString('a\\b')).toBe('"a\\\\b"');
  });
});

describe('quoteFieldIdentifier', () => {
  it('leaves a bare identifier unquoted', () => {
    expect(quoteFieldIdentifier('status_code')).toBe('status_code');
    expect(quoteFieldIdentifier('http.method')).toBe('http.method');
  });

  it('leaves the reserved fields unquoted', () => {
    expect(quoteFieldIdentifier('_time')).toBe('_time');
    expect(quoteFieldIdentifier('_msg')).toBe('_msg');
  });

  it('quotes anything a bare identifier cannot express', () => {
    // The colon in a storage prefix is what forces quoting.
    expect(quoteFieldIdentifier('span_attr:http.method')).toBe('"span_attr:http.method"');
    expect(quoteFieldIdentifier('9lives')).toBe('"9lives"');
  });
});

describe('serializeFieldCondition', () => {
  it.each([
    ['exists', 'status_code', '', 'status_code:*'],
    ['equals', 'status_code', '2', 'status_code:="2"'],
    ['not_equals', 'status_code', '2', 'status_code:!="2"'],
    ['contains', 'name', 'order', 'name:"order"'],
    ['has_prefix', 'name', 'GET', 'name:="GET"*'],
    ['regexp', 'name', '^GET .*', 'name:~"^GET .*"'],
  ] as const)('renders %s', (operator, field, value, expected) => {
    expect(serializeFieldCondition(field, operator, value)).toBe(expected);
  });

  it('renders has_suffix as an anchored regex with the value escaped', () => {
    // LogsQL has no suffix operator, and a literal dot must not act as "any".
    expect(serializeFieldCondition('name', 'has_suffix', '/api.v1')).toBe('name:~"/api\\\\.v1$"');
  });

  it('quotes the field where needed', () => {
    expect(serializeFieldCondition('span_attr:http.method', 'equals', 'GET')).toBe(
      '"span_attr:http.method":="GET"'
    );
  });

  it('marks only exists as needing no value', () => {
    const valueless = FILTER_OPERATORS.filter((o) => !o.needsValue).map((o) => o.id);
    expect(valueless).toEqual(['exists']);
  });
});
