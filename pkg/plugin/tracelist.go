package plugin

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

// The trace list is a LogsQL aggregation rather than a Tempo search: the Tempo
// summary carries five fields, and the list needs span counts, error counts and
// the full service set per trace. Ported from visum's useSearchTraceList.

// TraceListRow is one row of the trace list.
type TraceListRow struct {
	TraceID       string   `json:"traceID"`
	RootService   string   `json:"rootService"`
	RootOperation string   `json:"rootOperation"`
	Services      []string `json:"services"`
	// StartTime is the earliest span timestamp in the trace, RFC3339. It
	// doubles as the paging cursor.
	StartTime      string `json:"startTime"`
	DurationMicros int64  `json:"durationMicros"`
	Spans          int    `json:"spans"`
	Errors         int    `json:"errors"`
	// Attrs holds the caller-requested span fields, keyed by field name. Taken
	// from the root span, so a value describes the trace rather than an
	// arbitrary span within it.
	Attrs map[string]string `json:"attrs,omitempty"`
	// MatchedSpanID is the span that satisfied the service/operation filter,
	// when one was applied.
	MatchedSpanID string `json:"matchedSpanID,omitempty"`
	// Partial marks a trace whose root span falls outside the queried range,
	// so its service and operation are best-effort.
	Partial bool `json:"partial"`
}

// TraceListParams are the inputs to the trace-list aggregation.
type TraceListParams struct {
	// Where is a raw LogsQL filter. Empty defaults to defaultTraceListWhere.
	Where string
	// PostFilter is applied after the stats aggregation, so it can reference
	// aggregated columns (spans, durationNs) that `Where` cannot see. Expected
	// form: "| filter spans:>=3 durationNs:>=1000000".
	PostFilter string
	// CustomFields are extra span fields to surface as list columns.
	CustomFields []string
	// MatchCond is the bare service/operation condition. When set, each row also
	// records which span matched it, so opening a filtered row can land on that
	// span instead of the trace's root.
	MatchCond string
	// Start and End bound the query; End doubles as the paging cursor and
	// moves backwards through time. Both are passed to LogsQL verbatim.
	Start string
	End   string
	Limit int
}

// defaultTraceListWhere matches every span. "*" is not usable here because the
// aggregation groups by trace_id, which requires a field-bearing filter.
const defaultTraceListWhere = "span_id:*"

// buildTraceListQuery assembles the LogsQL aggregation. Grouping by trace_id
// collapses a trace's spans into one row; the `if (-parent_span_id:*)`
// conditions pick out the root span for the trace-level service and operation.
func buildTraceListQuery(where, postFilter, matchCond string, customFields []string, limit int) string {
	if where == "" {
		where = defaultTraceListWhere
	}
	if limit <= 0 {
		limit = defaultTraceListLimit
	}

	var b strings.Builder
	b.WriteString(where)
	writeTraceAggregation(&b, customFields, matchCond)
	if postFilter != "" {
		b.WriteString(" ")
		b.WriteString(postFilter)
	}
	b.WriteString(" | sort by (startTime desc) | limit ")
	b.WriteString(strconv.Itoa(limit))
	return b.String()
}

// writeTraceAggregation emits the per-trace stats pipe shared by the list and
// the scatter sample.
func writeTraceAggregation(b *strings.Builder, customFields []string, matchCond string) {
	b.WriteString(" | stats by (trace_id) ")
	b.WriteString("count() spans, ")
	b.WriteString("count() if (status_code:2) errors, ")
	b.WriteString(`values("resource_attr:service.name") if (-parent_span_id:*) rootService, `)
	b.WriteString("values(name) if (-parent_span_id:*) rootOperation, ")
	b.WriteString(`uniq_values("resource_attr:service.name") svcAll, `)
	b.WriteString("values(name) opAll, ")
	b.WriteString("max(duration) if (-parent_span_id:*) durationNs, ")
	b.WriteString("min(start_time_unix_nano) startMinNs, ")
	b.WriteString("max(end_time_unix_nano) endMaxNs, ")
	// Extra columns are collected positionally as c0, c1, … because a field name
	// is not safe to use as a LogsQL result name.
	for i, field := range customFields {
		if field == "" {
			continue
		}
		fmt.Fprintf(b, "values(%s) if (%s) c%d, ", logsqlQuoteValue(field), rootSpanOnly, i)
	}
	if matchCond != "" {
		fmt.Fprintf(b, "values(span_id) if (%s) matchedSpan, ", matchCond)
	}
	b.WriteString("min(_time) startTime")
}

// buildTraceSampleQuery draws a sample of traces for the scatter plot.
//
// Ordered by trace id, not by time: a time-ordered limit returns only the
// newest N, which against a busy source is a few seconds' worth and puts every
// point on the right-hand edge of the plot. Trace ids are effectively random,
// so the same limit spreads across the whole range. visum samples the same way.
func buildTraceSampleQuery(where string, limit int) string {
	if where == "" {
		where = defaultTraceListWhere
	}
	if limit <= 0 {
		limit = defaultScatterLimit
	}

	var b strings.Builder
	b.WriteString(where)
	writeTraceAggregation(&b, nil, "")
	b.WriteString(" | sort by (trace_id) | limit ")
	b.WriteString(strconv.Itoa(limit))
	return b.String()
}

// buildTraceCountQuery counts the traces the sample was drawn from, so the
// chart can say how much of the range it is showing.
func buildTraceCountQuery(where string) string {
	if where == "" {
		where = defaultTraceListWhere
	}
	return where + " | stats by (trace_id) count() spans | stats count() total"
}

// parseTraceCount reads the single-row total from buildTraceCountQuery.
func parseTraceCount(body io.Reader) (int64, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 4*1024), maxTraceListLineBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]string
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		total, _ := strconv.ParseInt(row["total"], 10, 64)
		return total, nil
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("reading trace count: %w", err)
	}
	return 0, nil
}

const defaultTraceListLimit = 50

// defaultScatterLimit matches visum's DEFAULT_SCATTER_LIMIT.
const defaultScatterLimit = 1000

// firstJSONValue reads the first entry of a LogsQL `values(...)` result, which
// arrives as a JSON array string. Non-array values pass through unchanged.
func firstJSONValue(v string) string {
	if v == "" {
		return ""
	}
	var arr []interface{}
	if err := json.Unmarshal([]byte(v), &arr); err != nil {
		return v
	}
	if len(arr) == 0 {
		return ""
	}
	return fmt.Sprint(arr[0])
}

// allJSONValues reads every entry of a LogsQL `values(...)` result.
func allJSONValues(v string) []string {
	if v == "" {
		return nil
	}
	var arr []interface{}
	if err := json.Unmarshal([]byte(v), &arr); err != nil {
		return []string{v}
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s := fmt.Sprint(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// nanoStringToMicros converts a nanosecond count to microseconds. Values can
// exceed int64 range in malformed data, so big.Int is used rather than
// ParseInt.
func nanoStringToMicros(nano string) (int64, bool) {
	if nano == "" {
		return 0, false
	}
	n, ok := new(big.Int).SetString(nano, 10)
	if !ok {
		f, err := strconv.ParseFloat(nano, 64)
		if err != nil {
			return 0, false
		}
		return int64(f / 1000), true
	}
	return new(big.Int).Div(n, big.NewInt(1000)).Int64(), true
}

// extentMicros derives a duration from the trace's first and last span
// timestamps. Used when the root span is outside the queried range, so
// max(duration) has nothing to report.
func extentMicros(startNs, endNs string) (int64, bool) {
	if startNs == "" || endNs == "" {
		return 0, false
	}
	s, sok := new(big.Int).SetString(startNs, 10)
	e, eok := new(big.Int).SetString(endNs, 10)
	if !sok || !eok {
		return 0, false
	}
	d := new(big.Int).Sub(e, s)
	if d.Sign() <= 0 {
		return 0, false
	}
	return new(big.Int).Div(d, big.NewInt(1000)).Int64(), true
}

// parseTraceListRows reads the NDJSON body of /select/logsql/query into rows.
// Lines that are not valid JSON, or that carry no trace_id, are skipped rather
// than failing the whole page.
func parseTraceListRows(body io.Reader, customFields []string) ([]TraceListRow, error) {
	rows := []TraceListRow{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxTraceListLineBytes)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var o map[string]string
		if err := json.Unmarshal([]byte(line), &o); err != nil {
			continue
		}
		traceID := o["trace_id"]
		if traceID == "" {
			continue
		}

		rootService := firstJSONValue(o["rootService"])
		rootOperation := firstJSONValue(o["rootOperation"])
		// No root service means the root span is outside the queried range.
		partial := rootService == ""

		duration, ok := nanoStringToMicros(o["durationNs"])
		if !ok {
			duration, _ = extentMicros(o["startMinNs"], o["endMaxNs"])
		}

		if rootService == "" {
			rootService = firstJSONValue(o["svcAll"])
		}
		if rootOperation == "" {
			rootOperation = firstJSONValue(o["opAll"])
		}

		services := allJSONValues(o["svcAll"])
		// The root service leads the chip row; the rest keep their sorted order.
		if rootService != "" {
			ordered := []string{rootService}
			for _, s := range services {
				if s != rootService {
					ordered = append(ordered, s)
				}
			}
			services = ordered
		}
		if services == nil {
			services = []string{}
		}

		spans, _ := strconv.Atoi(o["spans"])
		errCount, _ := strconv.Atoi(o["errors"])

		var attrs map[string]string
		for i, field := range customFields {
			if field == "" {
				continue
			}
			if v := firstJSONValue(o[fmt.Sprintf("c%d", i)]); v != "" {
				if attrs == nil {
					attrs = make(map[string]string, len(customFields))
				}
				attrs[field] = v
			}
		}

		rows = append(rows, TraceListRow{
			TraceID:        traceID,
			RootService:    rootService,
			RootOperation:  rootOperation,
			Services:       services,
			StartTime:      o["startTime"],
			DurationMicros: duration,
			Spans:          spans,
			Errors:         errCount,
			MatchedSpanID:  firstJSONValue(o["matchedSpan"]),
			Partial:        partial,
			Attrs:          attrs,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading trace list response: %w", err)
	}
	return rows, nil
}

// maxTraceListLineBytes caps a single NDJSON line. Rows aggregate a whole
// trace, so a trace with very many distinct services can produce a long line.
const maxTraceListLineBytes = 4 * 1024 * 1024

// operationDurationsLimit bounds the duration sample behind the preview
// panel's histogram. It is a distribution, not an exact count, so a capped
// sample is sufficient.
const operationDurationsLimit = 1000

// logsqlQuoteValue quotes a value for an exact-match LogsQL filter. %q escapes
// embedded quotes and backslashes, so service and operation names containing
// spaces, dots or quotes are matched literally rather than parsed as syntax.
func logsqlQuoteValue(v string) string {
	return fmt.Sprintf("%q", v)
}

// buildOperationDurationsQuery selects the duration of every span matching a
// service and operation. rootOnly restricts it to root spans, which is what a
// trace row compares against: a trace's duration is its root span's duration,
// and reused operation names (GET, execute) would otherwise pull in unrelated
// child spans.
func buildOperationDurationsQuery(service, operation string, rootOnly bool) string {
	where := fmt.Sprintf(`"resource_attr:service.name":%s AND name:%s`,
		logsqlQuoteValue(service), logsqlQuoteValue(operation))
	if rootOnly {
		where += " AND -parent_span_id:*"
	}
	return fmt.Sprintf("%s | fields duration | limit %d", where, operationDurationsLimit)
}

// parseDurationsMicros reads the NDJSON body of a `| fields duration` query
// into an ascending list of microsecond durations, ready for the histogram.
func parseDurationsMicros(body io.Reader) ([]int64, error) {
	out := []int64{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 8*1024), maxTraceListLineBytes)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var o map[string]string
		if err := json.Unmarshal([]byte(line), &o); err != nil {
			continue
		}
		if micros, ok := nanoStringToMicros(o["duration"]); ok {
			out = append(out, micros)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading durations response: %w", err)
	}

	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

// OperationStat summarises one operation within a service.
type OperationStat struct {
	Operation         string `json:"operation"`
	Spans             int64  `json:"spans"`
	AvgDurationMicros int64  `json:"avgDurationMicros"`
	Errors            int64  `json:"errors"`
}

// OperationStatsResponse carries the operations plus whether the cap hid any.
type OperationStatsResponse struct {
	Stats     []OperationStat `json:"stats"`
	Truncated bool            `json:"truncated"`
}

// buildOperationStatsQuery aggregates a service's spans by operation name.
//
// Grouped by `name` rather than by trace: this answers "which operations does
// this service run, and which are slow or failing", so every span counts, not
// just root spans.
func buildOperationStatsQuery(service string) string {
	return fmt.Sprintf(
		"span_id:* AND \"resource_attr:service.name\":%s"+
			" | stats by (name) count() spans, avg(duration) avgDuration,"+
			" count() if (status_code:2) errors"+
			" | sort by (spans desc) | limit %d",
		logsqlQuoteValue(service), operationStatsLimit+1,
	)
}

// operationStatsLimit caps the operations returned. A service with more
// distinct operations than this is almost certainly generating names
// dynamically, and the overview is not the place to surface that.
const operationStatsLimit = 200

// parseOperationStats reads the NDJSON body of the operation-stats query. The
// query asks for one row more than the cap, so a full page means there were
// more operations than the overview shows — reported back rather than dropped
// silently.
func parseOperationStats(body io.Reader) ([]OperationStat, bool, error) {
	out := []OperationStat{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 16*1024), maxTraceListLineBytes)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var o map[string]string
		if err := json.Unmarshal([]byte(line), &o); err != nil {
			continue
		}
		name := o["name"]
		if name == "" {
			continue
		}

		spans, _ := strconv.ParseInt(o["spans"], 10, 64)
		errs, _ := strconv.ParseInt(o["errors"], 10, 64)
		// avg(duration) comes back as a float in nanoseconds.
		avgNs, _ := strconv.ParseFloat(o["avgDuration"], 64)

		out = append(out, OperationStat{
			Operation:         name,
			Spans:             spans,
			AvgDurationMicros: int64(avgNs / 1000),
			Errors:            errs,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, false, fmt.Errorf("reading operation stats: %w", err)
	}
	truncated := len(out) > operationStatsLimit
	if truncated {
		out = out[:operationStatsLimit]
	}
	return out, truncated, nil
}

// SpanListRow is one row of the span list: a single span rather than a whole
// trace.
type SpanListRow struct {
	TraceID        string            `json:"traceID"`
	SpanID         string            `json:"spanID"`
	Service        string            `json:"service"`
	Operation      string            `json:"operation"`
	StartTime      string            `json:"startTime"`
	DurationMicros int64             `json:"durationMicros"`
	Kind           string            `json:"kind"`
	StatusCode     int               `json:"statusCode"`
	Attrs          map[string]string `json:"attrs,omitempty"`
}

// buildSpanListQuery selects individual spans, newest first.
//
// No aggregation: in spans mode the filters apply to spans directly, so the
// rows are the matching spans rather than the traces that contain them.
func buildSpanListQuery(where string, limit int) string {
	if where == "" {
		where = defaultTraceListWhere
	}
	if limit <= 0 {
		limit = defaultTraceListLimit
	}
	return fmt.Sprintf("%s | sort by (_time) desc | limit %d", where, limit)
}

// parseSpanListRows reads the NDJSON body of the span query. Each line is a
// whole span record, so requested custom fields are read straight off it
// rather than from an aggregate.
func parseSpanListRows(body io.Reader, customFields []string) ([]SpanListRow, error) {
	rows := []SpanListRow{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxTraceListLineBytes)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var o map[string]string
		if err := json.Unmarshal([]byte(line), &o); err != nil {
			continue
		}
		if o["span_id"] == "" {
			continue
		}

		durationMicros, _ := nanoStringToMicros(o["duration"])
		statusCode, _ := strconv.Atoi(o["status_code"])

		var attrs map[string]string
		for _, field := range customFields {
			if field == "" {
				continue
			}
			if v := o[field]; v != "" {
				if attrs == nil {
					attrs = make(map[string]string, len(customFields))
				}
				attrs[field] = v
			}
		}

		rows = append(rows, SpanListRow{
			TraceID:        o["trace_id"],
			SpanID:         o["span_id"],
			Service:        o["resource_attr:service.name"],
			Operation:      o["name"],
			StartTime:      o["_time"],
			DurationMicros: durationMicros,
			Kind:           o["kind"],
			StatusCode:     statusCode,
			Attrs:          attrs,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading span list response: %w", err)
	}
	return rows, nil
}
