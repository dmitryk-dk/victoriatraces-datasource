// LogsQL vocabulary: the pipes, filters, keywords, stats functions and special
// fields the editor suggests, each with the one-line docs shown beside it.
//
// Generated from VictoriaLogs' logsql.md. Regenerate from the upstream docs
// rather than editing entries by hand.

export interface LogsQLFunction {
  label: string;
  type: string;
  detail?: string;
  info?: string;
}

export const logsQLPipes: LogsQLFunction[] = [
  {
    label: 'block_stats',
    type: 'function',
    detail: 'pipe',
    info: '<q> | block_stats pipe returns the following stats for each block processed by <q> query:.',
  },
  {
    label: 'blocks_count',
    type: 'function',
    detail: 'pipe',
    info: '<q> | blocks_count pipe counts the number of blocks with logs processed by <q>.',
  },
  {
    label: 'collapse_nums',
    type: 'function',
    detail: 'pipe',
    info: '<q> | collapse_nums at <field> pipe replaces all the decimal and hexadecimal numbers at the given <field> returned by the <q> query with <N> placeholder.',
  },
  {
    label: 'copy',
    type: 'function',
    detail: 'pipe',
    info: 'If some log fields must be copied, then | copy src1 as dst1, ..., srcN as dstN pipe can be used.',
  },
  {
    label: 'decolorize',
    type: 'function',
    detail: 'pipe',
    info: '<q> | decolorize <field> pipe drops ANSI color codes from the given <field> across all the logs returned by <q> query..',
  },
  {
    label: 'delete',
    type: 'function',
    detail: 'pipe',
    info: 'If some log fields must be deleted, then | delete field1, ..., fieldN pipe can be used.',
  },
  {
    label: 'drop_empty_fields',
    type: 'function',
    detail: 'pipe',
    info: '<q> | drop_empty_fields pipe drops fields with empty values from results returned by <q> query.',
  },
  {
    label: 'extract',
    type: 'function',
    detail: 'pipe',
    info: '<q> | extract "pattern" from field_name pipe extracts text into output fields according to the pattern from the given field_name returned by <q> query.',
  },
  {
    label: 'extract_regexp',
    type: 'function',
    detail: 'pipe',
    info: '<q> | extract_regexp "pattern" from field_name pipe extracts substrings from the field_name field returned from <q> query according to the provided pattern, and stores them into field names according to the named fields inside the pattern.',
  },
  {
    label: 'facets',
    type: 'function',
    detail: 'pipe',
    info: '<q> | facets pipe returns the most frequent values for every seen log field returned by <q> query.',
  },
  {
    label: 'field_names',
    type: 'function',
    detail: 'pipe',
    info: '<q> | field_names pipe returns all the names of log fields with an estimated number of logs for each field name returned from <q> query..',
  },
  {
    label: 'field_values',
    type: 'function',
    detail: 'pipe',
    info: '<q> | field_values field_name pipe returns all the values for the given field_name field with the number of logs for each value returned from <q> query.',
  },
  {
    label: 'fields',
    type: 'function',
    detail: 'pipe',
    info: 'By default all the log fields are returned in the response.',
  },
  {
    label: 'filter',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | filter ...',
  },
  {
    label: 'first',
    type: 'function',
    detail: 'pipe',
    info: '<q> | first N by (fields) pipe returns the first N logs from <q> query after sorting them by the given fields..',
  },
  {
    label: 'format',
    type: 'function',
    detail: 'pipe',
    info: '<q> | format "pattern" as result_field pipe combines log fields from <q> query results according to the pattern and stores it into result_field..',
  },
  {
    label: 'generate_sequence',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | generate_sequence <N> pipe skips all the <q> results and generates <N> output logs with the _msg field containing integer sequence starting from 0 and ending at N-1..',
  },
  {
    label: 'join',
    type: 'function',
    detail: 'pipe',
    info: 'The <q1> | join by (<fields>) (<q2>) pipe joins <q1> query results with the <q2> results by the given set of comma-separated <fields>.',
  },
  {
    label: 'json_array_len',
    type: 'function',
    detail: 'pipe',
    info: '<q> | json_array_len(field) as result_field calculates the length of JSON array at the given field and stores it into the result_field, for every log entry returned by <q> query..',
  },
  {
    label: 'hash',
    type: 'function',
    detail: 'pipe',
    info: '<q> | hash(field) as result_field calculates hash value for the given field and stores it into the result_field, for every log entry returned by <q> query..',
  },
  {
    label: 'last',
    type: 'function',
    detail: 'pipe',
    info: '<q> | last N by (fields) pipe returns the last N logs from <q> query after sorting them by the given fields..',
  },
  {
    label: 'len',
    type: 'function',
    detail: 'pipe',
    info: '<q> | len(field) as result pipe stores byte length of the given field value into the result field across all the logs returned by <q> query..',
  },
  {
    label: 'limit',
    type: 'function',
    detail: 'pipe',
    info: 'If only a subset of selected logs must be processed, then | limit N pipe can be used, where N can contain any supported integer numeric value.',
  },
  {
    label: 'math',
    type: 'function',
    detail: 'pipe',
    info: '<q> | math ...',
  },
  {
    label: 'offset',
    type: 'function',
    detail: 'pipe',
    info: 'If some selected logs must be skipped after sort, then | offset N pipe can be used, where N can contain any supported integer numeric value.',
  },
  {
    label: 'pack_json',
    type: 'function',
    detail: 'pipe',
    info: '<q> | pack_json as field_name pipe packs all the fields of every log entry returned by <q> query into JSON object and stores it as a string in the given field_name..',
  },
  {
    label: 'pack_logfmt',
    type: 'function',
    detail: 'pipe',
    info: '<q> | pack_logfmt as field_name pipe packs all the fields for every log entry returned by <q> query into logfmt message and stores it as a string in the given field_name..',
  },
  {
    label: 'query_stats',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | query_stats pipe returns the following execution statistics for the given query <q>:.',
  },
  {
    label: 'rename',
    type: 'function',
    detail: 'pipe',
    info: 'If some log fields must be renamed, then | rename src1 as dst1, ..., srcN as dstN pipe can be used.',
  },
  {
    label: 'replace',
    type: 'function',
    detail: 'pipe',
    info: '<q> | replace ("old", "new") at field pipe replaces all the occurrences of the old substring with the new substring in the given field over all the logs returned by <q> query..',
  },
  {
    label: 'replace_regexp',
    type: 'function',
    detail: 'pipe',
    info: '<q> | replace_regexp ("regexp", "replacement") at field pipe replaces all the substrings matching the given regexp with the given replacement in the given field over all the logs returned by <q> query..',
  },
  {
    label: 'running_stats',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | running_stats ...',
  },
  {
    label: 'sample',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | sample N pipe returns 1/Nth random sample of logs for the <q> query.',
  },
  {
    label: 'set_stream_fields',
    type: 'function',
    detail: 'pipe',
    info: 'The | set_stream_fields field1, ..., fieldN pipe sets the given log fields as _stream fields..',
  },
  {
    label: 'sort',
    type: 'function',
    detail: 'pipe',
    info: 'By default logs are selected in arbitrary order for performance reasons.',
  },
  {
    label: 'split',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | split <separator> from <src_field> as <dst_field> pipe splits <src_field> log field obtained from <q> query results into <dst_field> as a JSON array, by using the given <separator>..',
  },
  {
    label: 'stats',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | stats ...',
  },
  {
    label: 'stream_context',
    type: 'function',
    detail: 'pipe',
    info: '<q> | stream_context ...',
  },
  {
    label: 'time_add',
    type: 'function',
    detail: 'pipe',
    info: '<q> | time_add <duration> adds the given <duration> to the _time field.',
  },
  {
    label: 'top',
    type: 'function',
    detail: 'pipe',
    info: '<q> | top N by (field1, ..., fieldN) pipe returns top N sets for (field1, ..., fieldN) log fields with the maximum number of matching log entries across logs returned by <q> query..',
  },
  {
    label: 'total_stats',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | total_stats ...',
  },
  {
    label: 'union',
    type: 'function',
    detail: 'pipe',
    info: '<q1> | union (<q2>) pipe returns results of <q1> query followed by results of <q2> query.',
  },
  {
    label: 'uniq',
    type: 'function',
    detail: 'pipe',
    info: '<q> | uniq by (field1, ..., fieldN) pipe returns unique values for the given log fields over the logs returned by <q> query.',
  },
  {
    label: 'unpack_json',
    type: 'function',
    detail: 'pipe',
    info: '<q> | unpack_json from field_name pipe unpacks {"k1":"v1", ..., "kN":"vN"} JSON from the given field_name of <q> query results into k1, ...',
  },
  {
    label: 'unpack_logfmt',
    type: 'function',
    detail: 'pipe',
    info: '<q> | unpack_logfmt from field_name pipe unpacks k1=v1 ...',
  },
  {
    label: 'unpack_syslog',
    type: 'function',
    detail: 'pipe',
    info: '<q> | unpack_syslog from field_name pipe unpacks syslog message from the given field_name of <q> query results.',
  },
  {
    label: 'unpack_words',
    type: 'function',
    detail: 'pipe',
    info: 'The <q> | unpack_words from <src_field> as <dst_field> pipe unpacks words from the given <src_field> log field of <q> query results into <dst_field> as a JSON array..',
  },
  {
    label: 'unroll',
    type: 'function',
    detail: 'pipe',
    info: '<q> | unroll by (field1, ..., fieldN) pipe can be used for unrolling JSON arrays from field1, ..., fieldN log fields of <q> query results into separate rows..',
  },
  {
    label: 'Profile',
    type: 'function',
    detail: 'pipe',
    info: 'Suppose you need to profile and optimize the following query:.',
  },
];

export const logsQLFilters: LogsQLFunction[] = [
  {
    label: 'time',
    type: 'function',
    detail: 'filter',
    info: "VictoriaLogs scans all the logs for each query if it doesn't contain the filter on the _time field.",
  },
  {
    label: 'day_range',
    type: 'function',
    detail: 'filter',
    info: '_time:day_range[start, end] filter allows returning logs in the particular start ...',
  },
  {
    label: 'week_range',
    type: 'function',
    detail: 'filter',
    info: '_time:week_range[start, end] filter allows returning logs on the particular start ...',
  },
  {
    label: 'stream',
    type: 'function',
    detail: 'filter',
    info: 'VictoriaLogs provides an optimized way to select logs, which belong to particular log streams.',
  },
  {
    label: '_stream_id',
    type: 'function',
    detail: 'filter',
    info: 'Every log stream in VictoriaLogs is uniquely identified by _stream_id field.',
  },
  {
    label: 'word',
    type: 'function',
    detail: 'filter',
    info: 'The simplest LogsQL query consists of a single word to search in log messages.',
  },
  {
    label: 'phrase',
    type: 'function',
    detail: 'filter',
    info: 'If you need to search for log messages with the specific phrase inside them, then just wrap the phrase into quotes according to these docs.',
  },
  {
    label: 'prefix',
    type: 'function',
    detail: 'filter',
    info: 'If you need to search for log messages with words / phrases containing some prefix, then just add * char to the end of the word / phrase in the query.',
  },
  {
    label: 'pattern_match',
    type: 'function',
    detail: 'filter',
    info: 'VictoriaLogs supports filtering logs by patterns with the pattern_match("pattern") filter.',
  },
  {
    label: 'substring',
    type: 'function',
    detail: 'filter',
    info: 'If it is needed to find logs with some substring, then *substring* filter can be used.',
  },
  {
    label: 'range_comparison',
    type: 'function',
    detail: 'filter',
    info: 'LogsQL supports field:>X, field:>=X, field:<X and field:<=X filters, where field is the name of log field and X is numeric value, IPv4 address or a string.',
  },
  {
    label: 'empty_value',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find log entries without the given log field.',
  },
  {
    label: 'any_value',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find log entries containing any non-empty value for the given log field.',
  },
  {
    label: 'exact',
    type: 'function',
    detail: 'filter',
    info: 'The word filter and phrase filter return log messages, which contain the given word or phrase inside them.',
  },
  {
    label: 'exact_prefix',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find log messages starting with some prefix.',
  },
  {
    label: 'contains_all',
    type: 'function',
    detail: 'filter',
    info: 'If it is needed to find logs, which contain all the given words / phrases, then v1 AND v2 ...',
  },
  {
    label: 'contains_any',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find logs, which contain at least one word or phrase out of many words / phrases.',
  },
  {
    label: 'subquery',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to select logs with fields matching values selected by another query (aka subquery).',
  },
  {
    label: 'equals_common_case',
    type: 'function',
    detail: 'filter',
    info: 'The field_name:equals_common_case(phrase1, ..., phraseN) filter searches for logs where the field_name log field equals the following phrases and words:.',
  },
  {
    label: 'contains_common_case',
    type: 'function',
    detail: 'filter',
    info: 'The field_name:contains_common_case(phrase1, ..., phraseN) filter searches for logs where the field_name log field contains the following phrases and words:.',
  },
  {
    label: 'sequence',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find log messages with words or phrases in a particular order.',
  },
  {
    label: 'regexp',
    type: 'function',
    detail: 'filter',
    info: 'LogsQL supports regular expression filter with RE2 syntax via ~"regex" syntax.',
  },
  {
    label: 'range',
    type: 'function',
    detail: 'filter',
    info: 'If you need to filter log message by some field containing only numeric values, then the range() filter can be used.',
  },
  {
    label: 'ipv4_range',
    type: 'function',
    detail: 'filter',
    info: 'If you need to filter log message by some field containing only IPv4 addresses such as 1.2.3.4, then the ipv4_range() filter can be used.',
  },
  {
    label: 'string_range',
    type: 'function',
    detail: 'filter',
    info: 'If you need to filter log message by some field with string values in some range, then string_range() filter can be used.',
  },
  {
    label: 'length_range',
    type: 'function',
    detail: 'filter',
    info: 'If you need to filter log message by its length, then len_range() filter can be used.',
  },
  {
    label: 'value_type',
    type: 'function',
    detail: 'filter',
    info: 'VictoriaLogs automatically detects types for the ingested log fields and stores log field values according to the detected type (such as const, dict, string, int64, float64, etc.).',
  },
  {
    label: 'eq_field',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find logs, which contain identical values in the given fields.',
  },
  {
    label: 'le_field',
    type: 'function',
    detail: 'filter',
    info: "Sometimes it is needed to find logs where one field value doesn't exceed the other field value.",
  },
  {
    label: 'lt_field',
    type: 'function',
    detail: 'filter',
    info: 'Sometimes it is needed to find logs where one field value is smaller than the other field value.',
  },
  {
    label: 'logical',
    type: 'function',
    detail: 'filter',
    info: 'Basic LogsQL filters can be combined into more complex filters with the following logical operations:.',
  },
  {
    label: 'test_stream',
    type: 'function',
    detail: 'filter',
    info: "If the query doesn't contain log stream filters, VictoriaLogs needs to read and scan all the data blocks on the selected time range.",
  },
];

export const logsQLKeywords: LogsQLFunction[] = [
  {
    label: 'AND',
    type: 'keyword',
    info: 'Logical AND operator - matches logs containing all conditions',
  },
  {
    label: 'NOT',
    type: 'keyword',
    info: 'Logical NOT operator - excludes logs matching the condition',
  },
  {
    label: 'OR',
    type: 'keyword',
    info: 'Logical OR operator - matches logs containing any condition',
  },
  {
    label: 'by',
    type: 'keyword',
    info: 'Groups or sorts results by the specified fields',
  },
  {
    label: 'as',
    type: 'keyword',
    info: 'Renames a field or assigns a result to a new field',
  },
  {
    label: 'from',
    type: 'keyword',
    info: 'Specifies the source field for unpack operations',
  },
  {
    label: 'at',
    type: 'keyword',
    info: 'Specifies the target field for replace operations',
  },
  {
    label: 'if',
    type: 'keyword',
    info: 'Conditional clause for extract operations',
  },
  { label: 'asc', type: 'keyword', info: 'Sort in ascending order' },
  { label: 'desc', type: 'keyword', info: 'Sort in descending order' },
  { label: 'limit', type: 'keyword', info: 'Limits the number of results' },
  {
    label: 'offset',
    type: 'keyword',
    info: 'Skips the specified number of results',
  },
];

export const logsQLStatsFunctions: LogsQLFunction[] = [
  {
    label: 'count',
    type: 'function',
    detail: 'stats',
    info: 'Count the number of log entries',
  },
  {
    label: 'count_empty',
    type: 'function',
    detail: 'stats',
    info: 'Count log entries with empty field value',
  },
  {
    label: 'count_uniq',
    type: 'function',
    detail: 'stats',
    info: 'Count unique values',
  },
  {
    label: 'sum',
    type: 'function',
    detail: 'stats',
    info: 'Calculate sum of numeric values',
  },
  {
    label: 'max',
    type: 'function',
    detail: 'stats',
    info: 'Find maximum value',
  },
  {
    label: 'min',
    type: 'function',
    detail: 'stats',
    info: 'Find minimum value',
  },
  {
    label: 'avg',
    type: 'function',
    detail: 'stats',
    info: 'Calculate average value',
  },
  {
    label: 'median',
    type: 'function',
    detail: 'stats',
    info: 'Calculate median value',
  },
  {
    label: 'quantile',
    type: 'function',
    detail: 'stats',
    info: 'Calculate quantile value',
  },
  {
    label: 'row_max',
    type: 'function',
    detail: 'stats',
    info: 'Maximum value across multiple fields in a row',
  },
  {
    label: 'row_min',
    type: 'function',
    detail: 'stats',
    info: 'Minimum value across multiple fields in a row',
  },
  {
    label: 'row_avg',
    type: 'function',
    detail: 'stats',
    info: 'Average value across multiple fields in a row',
  },
  {
    label: 'uniq_values',
    type: 'function',
    detail: 'stats',
    info: 'Return unique values as array',
  },
  {
    label: 'values',
    type: 'function',
    detail: 'stats',
    info: 'Return all values as array',
  },
];

export const logsQLSpecialFields: LogsQLFunction[] = [
  {
    label: '_time',
    type: 'field',
    detail: 'special',
    info: 'Timestamp of the log entry',
  },
  {
    label: '_msg',
    type: 'field',
    detail: 'special',
    info: 'Log message content',
  },
  {
    label: '_stream',
    type: 'field',
    detail: 'special',
    info: 'Log stream identifier',
  },
  {
    label: '_stream_id',
    type: 'field',
    detail: 'special',
    info: 'Unique stream identifier hash',
  },
];

export const allLogsQLCompletions: LogsQLFunction[] = [
  ...logsQLPipes,
  ...logsQLFilters,
  ...logsQLKeywords,
  ...logsQLStatsFunctions,
  ...logsQLSpecialFields,
];
