// Ported from visum's LogsQLEditor (operators.ts + serialize.ts) so the two
// products generate identical LogsQL for the same filter.

export type FilterOperator =
  | 'exists'
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'has_prefix'
  | 'has_suffix'
  | 'regexp';

export interface OperatorMeta {
  id: FilterOperator;
  label: string;
  description: string;
  needsValue: boolean;
}

export const FILTER_OPERATORS: readonly OperatorMeta[] = [
  { id: 'exists', label: 'exists', description: 'has any non-empty value', needsValue: false },
  { id: 'equals', label: 'equals', description: 'is exactly equal to specified value', needsValue: true },
  { id: 'not_equals', label: 'not equals', description: 'is not equal to specified value', needsValue: true },
  { id: 'contains', label: 'contains', description: 'contains the specified word or phrase', needsValue: true },
  { id: 'has_prefix', label: 'has prefix', description: 'starts with the specified string', needsValue: true },
  { id: 'has_suffix', label: 'has suffix', description: 'ends with the specified string', needsValue: true },
  { id: 'regexp', label: 'regexp', description: 'matches the specified regular expression', needsValue: true },
];

export function operatorMeta(op: FilterOperator): OperatorMeta | undefined {
  return FILTER_OPERATORS.find((o) => o.id === op);
}

/** How the filter names what it matches against. */
export type FilterMode = 'field' | 'custom' | 'all';

const RESERVED_FIELDS = new Set(['_time', '_msg', '_stream', '_stream_id']);

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function quoteString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Quotes a field name only when it is not already a bare identifier. */
export function quoteFieldIdentifier(name: string): string {
  if (IDENTIFIER_RE.test(name) || RESERVED_FIELDS.has(name)) {
    return name;
  }
  return quoteString(name);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Renders one field comparison as LogsQL, exactly as visum serializes it. */
export function serializeFieldCondition(
  field: string,
  operator: FilterOperator,
  value: string
): string {
  const f = quoteFieldIdentifier(field);
  switch (operator) {
    case 'exists':
      return `${f}:*`;
    case 'equals':
      return `${f}:=${quoteString(value)}`;
    case 'not_equals':
      return `${f}:!=${quoteString(value)}`;
    case 'contains':
      return `${f}:${quoteString(value)}`;
    case 'has_prefix':
      return `${f}:=${quoteString(value)}*`;
    case 'has_suffix':
      // LogsQL has no suffix operator, so this is an anchored regex.
      return `${f}:~${quoteString(`${escapeRegex(value)}$`)}`;
    case 'regexp':
      return `${f}:~${quoteString(value)}`;
  }
}
