import { logsQLKeywords, logsQLPipes, logsQLStatsFunctions } from './functions';

export const LOGSQL_LANGUAGE_ID = 'logsql';

/**
 * Syntax highlighting for LogsQL, as Monaco's Monarch describes it.
 *
 * A full grammar is more than colour needs, and Monaco takes token rules
 * directly. What earns a colour is what a
 * reader scans for in a long query: where each pipe stage begins, which parts
 * are literal values, and which words are the language rather than the data.
 */
export const logsqlLanguage = {
  pipes: logsQLPipes.map((p) => p.label),
  functions: logsQLStatsFunctions.map((f) => f.label),
  keywords: logsQLKeywords.map((k) => k.label),

  // Longest first: `!~` must win over `!`, and `>=` over `>`.
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/'(?:[^'\\]|\\.)*'/, 'string'],
      [/`(?:[^`\\]|\\.)*`/, 'string'],
      [/#.*$/, 'comment'],
      [/\d+(?:\.\d+)?(?:ns|µs|us|ms|s|m|h|d|w|y|KB|MB|GB|TB|Ki|Mi|Gi)?\b/, 'number'],
      [/\|/, 'operator'],
      [/=~|!~|!=|>=|<=|[=<>:]/, 'operator'],
      [/[(){}[\],]/, 'delimiter'],
      [
        /[A-Za-z_][\w.:\-/]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@pipes': 'keyword',
            '@functions': 'type',
            '@default': 'identifier',
          },
        },
      ],
    ],
  },
};
