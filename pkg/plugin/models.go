package plugin

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// JaegerResponse is the top-level response from the Jaeger-compatible API.
type JaegerResponse struct {
	Data   []JaegerTrace `json:"data"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
	Errors []interface{} `json:"errors"`
}

// JaegerTrace represents a single distributed trace.
type JaegerTrace struct {
	TraceID   string                   `json:"traceID"`
	Spans     []JaegerSpan             `json:"spans"`
	Processes map[string]JaegerProcess `json:"processes"`
	Warnings  []string                 `json:"warnings"`
}

// JaegerSpan represents a single span within a trace.
type JaegerSpan struct {
	TraceID       string            `json:"traceID"`
	SpanID        string            `json:"spanID"`
	OperationName string            `json:"operationName"`
	References    []JaegerReference `json:"references"`
	StartTime     int64             `json:"startTime"` // microseconds since epoch
	Duration      int64             `json:"duration"`  // microseconds
	Tags          []JaegerKeyValue  `json:"tags"`
	Logs          []JaegerLog       `json:"logs"`
	ProcessID     string            `json:"processID"`
	Warnings      []string          `json:"warnings"`
}

// JaegerReference is a parent/child relationship between spans.
type JaegerReference struct {
	RefType string `json:"refType"` // "CHILD_OF" or "FOLLOWS_FROM"
	TraceID string `json:"traceID"`
	SpanID  string `json:"spanID"`
}

// JaegerProcess holds service-level metadata for spans.
type JaegerProcess struct {
	ServiceName string           `json:"serviceName"`
	Tags        []JaegerKeyValue `json:"tags"`
}

// JaegerKeyValue is a generic key-value tag/attribute.
type JaegerKeyValue struct {
	Key   string      `json:"key"`
	Type  string      `json:"type"` // "string", "int64", "float64", "bool", "binary"
	Value interface{} `json:"value"`
}

// JaegerLog is a timestamped event attached to a span.
type JaegerLog struct {
	Timestamp int64            `json:"timestamp"` // microseconds
	Fields    []JaegerKeyValue `json:"fields"`
}

// JaegerServicesResponse is the response from /select/jaeger/api/services.
type JaegerServicesResponse struct {
	Data   []string      `json:"data"`
	Total  int           `json:"total"`
	Errors []interface{} `json:"errors"`
}

// JaegerOperationsResponse is the response from /select/jaeger/api/operations.
type JaegerOperationsResponse struct {
	Data   []string      `json:"data"`
	Total  int           `json:"total"`
	Errors []interface{} `json:"errors"`
}

// ServiceDependency is one edge of the service dependency graph returned by
// /select/jaeger/api/dependencies.
type ServiceDependency struct {
	Parent    string `json:"parent"`
	Child     string `json:"child"`
	CallCount int64  `json:"callCount"`
}

// JaegerDependenciesResponse is the response from /select/jaeger/api/dependencies.
type JaegerDependenciesResponse struct {
	Data   []ServiceDependency `json:"data"`
	Total  int                 `json:"total"`
	Errors []interface{}       `json:"errors"`
}

// FlexInt64 accepts a JSON number or a JSON string holding a number. The Tempo
// search API is inconsistent about which it uses for nanosecond timestamps —
// upstream Tempo quotes them, VictoriaTraces does not.
type FlexInt64 int64

// UnmarshalJSON implements json.Unmarshaler.
func (f *FlexInt64) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*f = 0
		return nil
	}
	// Durations occasionally arrive fractional (e.g. 12.5); truncate rather than fail.
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return fmt.Errorf("parsing %q as a number: %w", s, err)
	}
	*f = FlexInt64(v)
	return nil
}

// TempoTraceSummary is one entry from /select/tempo/api/search.
type TempoTraceSummary struct {
	TraceID           string    `json:"traceID"`
	RootServiceName   string    `json:"rootServiceName"`
	RootTraceName     string    `json:"rootTraceName"`
	StartTimeUnixNano FlexInt64 `json:"startTimeUnixNano"`
	DurationMs        FlexInt64 `json:"durationMs"`
}

// TempoSearchResponse is the response from /select/tempo/api/search.
type TempoSearchResponse struct {
	Traces []TempoTraceSummary `json:"traces"`
}

// LogsQL Prometheus-style response types for /select/logsql/stats_query_range.

// LogsQLValue is a [timestamp, value] pair returned by the stats endpoint.
type LogsQLValue [2]interface{}

// LogsQLLabels holds the metric labels for a single time series.
type LogsQLLabels map[string]string

// LogsQLResult is one time series in the response.
// Values is populated for matrix (range) queries; Value for vector (instant) queries.
type LogsQLResult struct {
	Labels LogsQLLabels  `json:"metric"`
	Values []LogsQLValue `json:"values"` // matrix: stats_query_range
	Value  LogsQLValue   `json:"value"`  // vector: stats_query
}

// LogsQLData wraps the resultType and raw result JSON.
type LogsQLData struct {
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
}

// LogsQLResponse is the top-level response from stats_query_range.
type LogsQLResponse struct {
	Status string     `json:"status"`
	Data   LogsQLData `json:"data"`
	Error  string     `json:"error"`
}

// Hit represents a single hit group from /select/logsql/hits.
type Hit struct {
	Fields     map[string]string `json:"fields"`
	Timestamps []string          `json:"timestamps"`
	Values     []float64         `json:"values"`
	Total      int               `json:"total"`
}

// HitsResponse is the top-level response from /select/logsql/hits.
type HitsResponse struct {
	Hits []Hit `json:"hits"`
}

// ValueWithHits is a single entry returned by /select/logsql/field_names and field_values.
type ValueWithHits struct {
	Value string `json:"value"`
	Hits  int64  `json:"hits"`
}

// FieldNamesResponse is the response from /select/logsql/field_names.
type FieldNamesResponse struct {
	Values []ValueWithHits `json:"values"`
}

// FieldValuesResponse is the response from /select/logsql/field_values.
type FieldValuesResponse struct {
	Values []ValueWithHits `json:"values"`
}
