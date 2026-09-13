import { LOGSQL_LANGUAGE_ID, logsqlLanguage } from './monarch';

/** Every rule's pattern, flattened, so a rule can be exercised directly. */
const rules = Object.values(logsqlLanguage.tokenizer).flat() as Array<[RegExp, unknown]>;

function tokenFor(text: string): string | undefined {
  for (const [pattern, action] of rules) {
    const match = new RegExp(`^(?:${pattern.source})`, pattern.flags.replace('g', '')).exec(text);
    if (match && match[0].length === text.length) {
      return typeof action === 'string' ? action : undefined;
    }
  }
  return undefined;
}

describe('logsqlLanguage', () => {
  it('is registered under a stable id', () => {
    expect(LOGSQL_LANGUAGE_ID).toBe('logsql');
  });

  it('colours a pipe apart from the rest of the query', () => {
    expect(tokenFor('|')).toBe('operator');
  });

  it('colours comparison and regex operators', () => {
    for (const op of ['=', '!=', '=~', '!~', ':', '>=']) {
      expect(tokenFor(op)).toBe('operator');
    }
  });

  it('colours a quoted value as a string', () => {
    expect(tokenFor('"frontend"')).toBe('string');
  });

  it('colours durations and numbers', () => {
    expect(tokenFor('5m')).toBe('number');
    expect(tokenFor('1.5')).toBe('number');
  });

  it('knows the pipes and keywords it should highlight', () => {
    expect(logsqlLanguage.pipes).toContain('stats');
    expect(logsqlLanguage.keywords).toContain('AND');
  });
});
