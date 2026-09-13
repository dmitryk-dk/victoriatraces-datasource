import {
  allLogsQLCompletions,
  logsQLFilters,
  logsQLKeywords,
  logsQLPipes,
  logsQLSpecialFields,
  logsQLStatsFunctions,
  type LogsQLFunction,
} from './functions';
import type { CompletionContext } from './context';

/** One suggestion, in the shape the editor renders it. */
export interface LogsQLCompletion {
  label: string;
  /** The grey note beside the label: what kind of thing this is. */
  detail: string;
  /** The panel beside the list: what it does. */
  documentation: string;
  kind: 'pipe' | 'function' | 'keyword' | 'field' | 'value';
}

/** What the datasource knows about this query's data. */
export interface CompletionData {
  fields: readonly string[];
  values: readonly string[];
}

function fromVocabulary(fn: LogsQLFunction, kind: LogsQLCompletion['kind']): LogsQLCompletion {
  return {
    label: fn.label,
    detail: fn.detail ?? fn.type,
    documentation: fn.info ?? '',
    kind,
  };
}

function asField(field: string): LogsQLCompletion {
  return { label: field, detail: 'field', documentation: `Field ${field}`, kind: 'field' };
}

/** First occurrence wins, so a documented term keeps its docs. */
function unique(items: LogsQLCompletion[]): LogsQLCompletion[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.label) ? false : (seen.add(item.label), true)));
}

/**
 * What to suggest at the cursor.
 *
 * The list is not filtered by the word already typed: the editor does that
 * itself, and doing it here as well would hide a term the moment the editor's
 * own fuzzy match disagrees with a prefix match.
 */
export function completionsFor(context: CompletionContext, data: CompletionData): LogsQLCompletion[] {
  switch (context.kind) {
    case 'pipe':
      return unique([
        ...logsQLPipes.map((fn) => fromVocabulary(fn, 'pipe')),
        ...logsQLStatsFunctions.map((fn) => fromVocabulary(fn, 'function')),
      ]);

    case 'field':
      return unique([
        ...data.fields.map(asField),
        ...logsQLSpecialFields.map((fn) => fromVocabulary(fn, 'field')),
      ]);

    case 'fieldValue':
      return data.values.map((value) => ({
        label: value,
        detail: context.field,
        documentation: '',
        kind: 'value' as const,
      }));

    case 'filterOrField':
      return unique([
        ...data.fields.map(asField),
        ...logsQLSpecialFields.map((fn) => fromVocabulary(fn, 'field')),
        ...logsQLFilters.map((fn) => fromVocabulary(fn, 'function')),
        ...logsQLKeywords.map((fn) => fromVocabulary(fn, 'keyword')),
      ]);
  }
}

const BY_LABEL = new Map(allLogsQLCompletions.map((fn) => [fn.label, fn]));

/**
 * The docs for a term, for the tooltip shown on hover.
 *
 * Hover answers the question typing cannot: what a term already in the query
 * does, without deleting it to bring the suggestion list back.
 */
export function docFor(word: string): { detail: string; documentation: string } | undefined {
  const fn = BY_LABEL.get(word);
  if (!fn) {
    return undefined;
  }
  return { detail: fn.detail ?? fn.type, documentation: fn.info ?? '' };
}
