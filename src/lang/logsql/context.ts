/**
 * Where the cursor sits in a LogsQL query, and so what to offer there.
 *
 * Monaco has no LogsQL grammar to resolve this from, so it reads the text
 * before the cursor instead. The cases are the ones
 * that change what a suggestion should be: after a pipe only pipes make sense,
 * after `field:` only that field's values do, and inside `{…}` only stream
 * fields. Everything else is the opening position, where a filter or a field
 * both read correctly.
 */

export type CompletionContext =
  | { kind: 'pipe'; word: string }
  | { kind: 'field'; word: string }
  | { kind: 'fieldValue'; field: string; word: string }
  | { kind: 'filterOrField'; word: string };

/** A field name: dots and colons are part of it (`resource_attr:service.name`). */
const FIELD = String.raw`[\w.:\-/]+`;

const AFTER_PIPE = new RegExp(String.raw`\|\s*(\w*)$`);
const STREAM_FIELD_VALUE = new RegExp(String.raw`[{,]\s*(${FIELD})\s*(?:=~|!~|!=|=)\s*"?([^"]*)$`);
const STREAM_FIELD = new RegExp(String.raw`[{,]\s*(${FIELD})?$`);
const FIELD_VALUE = new RegExp(String.raw`(?:^|[\s(])(${FIELD}):\s*"?([^"\s]*)$`);
const WORD = /(\S*)$/;

/** True while a `{` is still waiting for its `}`. */
function insideStreamSelector(text: string): boolean {
  return text.lastIndexOf('{') > text.lastIndexOf('}');
}

export function completionContext(textBeforeCursor: string): CompletionContext {
  const text = textBeforeCursor;

  if (insideStreamSelector(text)) {
    const value = STREAM_FIELD_VALUE.exec(text);
    if (value) {
      return { kind: 'fieldValue', field: value[1], word: value[2] };
    }
    const field = STREAM_FIELD.exec(text);
    if (field) {
      return { kind: 'field', word: field[1] ?? '' };
    }
  }

  const pipe = AFTER_PIPE.exec(text);
  if (pipe) {
    return { kind: 'pipe', word: pipe[1] };
  }

  const value = FIELD_VALUE.exec(text);
  if (value) {
    return { kind: 'fieldValue', field: value[1], word: value[2] };
  }

  return { kind: 'filterOrField', word: WORD.exec(text)?.[1] ?? '' };
}
