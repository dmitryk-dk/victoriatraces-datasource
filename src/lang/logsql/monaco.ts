import type { monacoTypes } from '@grafana/ui';

import { completionsFor, docFor, type LogsQLCompletion } from './completions';
import { completionContext } from './context';
import type { LogsqlFetchers } from './fetchers';
import { LOGSQL_LANGUAGE_ID, logsqlLanguage } from './monarch';

type Monaco = typeof monacoTypes;

/**
 * Teaches Monaco LogsQL: colour, suggestions and hover docs.
 *
 * Registration is per language, not per editor, so it happens once and the
 * providers look up the editor's own fetchers by model — several LogsQL fields
 * can be open at once (the query editor and the trace filter bar), each
 * pointed at a different datasource and range.
 */
const fetchersByModel = new Map<string, LogsqlFetchers | undefined>();

let registered = false;

export function registerFetchersFor(model: monacoTypes.editor.ITextModel, fetchers?: LogsqlFetchers): () => void {
  const key = model.uri.toString();
  fetchersByModel.set(key, fetchers);
  return () => {
    fetchersByModel.delete(key);
  };
}

function kindFor(monaco: Monaco, completion: LogsQLCompletion): monacoTypes.languages.CompletionItemKind {
  switch (completion.kind) {
    case 'pipe':
    case 'keyword':
      return monaco.languages.CompletionItemKind.Keyword;
    case 'function':
      return monaco.languages.CompletionItemKind.Function;
    case 'field':
      return monaco.languages.CompletionItemKind.Field;
    case 'value':
      return monaco.languages.CompletionItemKind.Value;
  }
}

export function registerLogsqlLanguage(monaco: Monaco): void {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.register({ id: LOGSQL_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(
    LOGSQL_LANGUAGE_ID,
    logsqlLanguage as unknown as monacoTypes.languages.IMonarchLanguage
  );

  monaco.languages.registerCompletionItemProvider(LOGSQL_LANGUAGE_ID, {
    // A colon or a pipe changes what belongs next, so the list reopens there
    // rather than waiting for the next letter.
    triggerCharacters: ['|', ':', '{', ',', '"', '=', ' '],
    provideCompletionItems: async (model, position) => {
      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const context = completionContext(textBefore);
      const fetchers = fetchersByModel.get(model.uri.toString());

      let fields: string[] = [];
      let values: string[] = [];
      try {
        if (context.kind === 'fieldValue') {
          values = (await fetchers?.values(context.field)) ?? [];
        } else if (context.kind === 'field' || context.kind === 'filterOrField') {
          fields = (await fetchers?.fields()) ?? [];
        }
      } catch {
        // The language's own vocabulary is still worth offering when the
        // datasource cannot answer.
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: completionsFor(context, { fields, values }).map((item) => ({
          label: item.label,
          kind: kindFor(monaco, item),
          detail: item.detail,
          documentation: item.documentation ? { value: item.documentation } : undefined,
          insertText: item.label,
          range,
        })),
      };
    },
  });

  monaco.languages.registerHoverProvider(LOGSQL_LANGUAGE_ID, {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      const doc = word && docFor(word.word);
      if (!doc) {
        return null;
      }
      return {
        contents: [{ value: `**${word!.word}** — ${doc.detail}` }, { value: doc.documentation }],
      };
    },
  });
}
