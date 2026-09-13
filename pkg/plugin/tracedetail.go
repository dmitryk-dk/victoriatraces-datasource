package plugin

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// maxTraceSpans caps a single trace's spans. A trace larger than this is
// pathological, and pulling it whole would stall the browser rather than show
// anything.
const maxTraceSpans = 10000

const (
	resourceAttrPrefix = "resource_attr:"
	eventPrefix        = "event:"
)

// otelSpanKind maps the OTLP kind enum to the names the detail view shows.
var otelSpanKind = map[string]string{
	"0": "unspecified",
	"1": "internal",
	"2": "server",
	"3": "client",
	"4": "producer",
	"5": "consumer",
}

// buildTraceSpansQuery selects every span of one trace.
//
// The spans come from LogsQL rather than the Jaeger API because that is the
// record as stored: attributes, events and scope survive it unchanged, and a
// trace still being ingested can be asked for again and answer with more.
func buildTraceSpansQuery(traceID string) string {
	return fmt.Sprintf("trace_id:%s | limit %d", logsqlQuoteValue(traceID), maxTraceSpans)
}

// nanosToMicros converts a nanosecond field to the microseconds Jaeger's shape
// uses. A missing or unparseable value reports not-present rather than zero,
// which lets the caller fall back to another field.
func nanosToMicros(raw string) (int64, bool) {
	if raw == "" {
		return 0, false
	}
	ns, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return ns / 1000, true
}

// parseTraceFromSpans rebuilds a trace from the span records LogsQL returns.
func parseTraceFromSpans(traceID string, body io.Reader) (JaegerTrace, error) {
	trace := JaegerTrace{
		TraceID:   traceID,
		Spans:     []JaegerSpan{},
		Processes: map[string]JaegerProcess{},
		Warnings:  []string{},
	}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record map[string]string
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			// One malformed line must not cost the whole trace.
			continue
		}
		spanID := record["span_id"]
		if spanID == "" {
			continue
		}

		service := record[resourceAttrPrefix+"service.name"]
		if service == "" {
			service = record["scope_name"]
		}
		if service == "" {
			service = "unknown"
		}
		if _, seen := trace.Processes[service]; !seen {
			trace.Processes[service] = JaegerProcess{ServiceName: service, Tags: resourceTags(record)}
		}

		trace.Spans = append(trace.Spans, JaegerSpan{
			TraceID:       traceID,
			SpanID:        spanID,
			OperationName: record["name"],
			ProcessID:     service,
			StartTime:     spanStart(record),
			Duration:      spanDuration(record),
			References:    spanReferences(traceID, record),
			Tags:          spanTags(record),
			Logs:          spanEvents(record),
			Warnings:      []string{},
		})
	}
	if err := scanner.Err(); err != nil {
		return trace, fmt.Errorf("reading trace spans: %w", err)
	}
	return trace, nil
}

func spanStart(record map[string]string) int64 {
	if micros, ok := nanosToMicros(record["start_time_unix_nano"]); ok {
		return micros
	}
	// _time is the ingestion timestamp, and the only anchor left when a span
	// arrives without its own start.
	return parseRFC3339(record["_time"]).UnixMicro()
}

func spanDuration(record map[string]string) int64 {
	if micros, ok := nanosToMicros(record["duration"]); ok {
		return micros
	}
	end, hasEnd := nanosToMicros(record["end_time_unix_nano"])
	if !hasEnd {
		return 0
	}
	if d := end - spanStart(record); d > 0 {
		return d
	}
	return 0
}

func spanReferences(traceID string, record map[string]string) []JaegerReference {
	parent := record["parent_span_id"]
	if parent == "" {
		return []JaegerReference{}
	}
	return []JaegerReference{{RefType: "CHILD_OF", TraceID: traceID, SpanID: parent}}
}

// resourceTags collects the resource attributes describing the service.
func resourceTags(record map[string]string) []JaegerKeyValue {
	tags := []JaegerKeyValue{}
	for key, value := range record {
		if name, ok := strings.CutPrefix(key, resourceAttrPrefix); ok {
			tags = append(tags, JaegerKeyValue{Key: name, Type: "string", Value: value})
		}
	}
	sortTags(tags)
	return tags
}

// spanTags collects the span's own attributes, plus the stored columns the
// detail view reads as tags.
func spanTags(record map[string]string) []JaegerKeyValue {
	tags := []JaegerKeyValue{}
	for key, value := range record {
		if name, ok := strings.CutPrefix(key, spanAttrPrefix); ok {
			tags = append(tags, JaegerKeyValue{Key: name, Type: "string", Value: value})
		}
	}
	sortTags(tags)

	if kind := record["kind"]; kind != "" {
		name, ok := otelSpanKind[kind]
		if !ok {
			name = kind
		}
		tags = append(tags, JaegerKeyValue{Key: "span.kind", Type: "string", Value: name})
	}
	for column, tag := range map[string]string{
		"status_code":   "otel.status_code",
		"scope_name":    "otel.scope.name",
		"scope_version": "otel.scope.version",
	} {
		if value := record[column]; value != "" {
			tags = append(tags, JaegerKeyValue{Key: tag, Type: "string", Value: value})
		}
	}
	return tags
}

// spanEvents rebuilds the span's events, which are stored flattened: each field
// carries the event's index as its last colon-separated segment.
func spanEvents(record map[string]string) []JaegerLog {
	type bucket struct {
		name   string
		nanos  string
		fields []JaegerKeyValue
	}
	buckets := map[string]*bucket{}
	at := func(index string) *bucket {
		if existing, ok := buckets[index]; ok {
			return existing
		}
		created := &bucket{fields: []JaegerKeyValue{}}
		buckets[index] = created
		return created
	}

	for key, value := range record {
		rest, ok := strings.CutPrefix(key, eventPrefix)
		if !ok {
			continue
		}
		lastColon := strings.LastIndex(rest, ":")
		if lastColon <= 0 {
			continue
		}
		kind, index := rest[:lastColon], rest[lastColon+1:]
		switch {
		case kind == "event_name":
			at(index).name = value
		case kind == "event_time_unix_nano":
			at(index).nanos = value
		default:
			if attr, isAttr := strings.CutPrefix(kind, "event_attr:"); isAttr {
				b := at(index)
				b.fields = append(b.fields, JaegerKeyValue{Key: attr, Type: "string", Value: value})
			}
		}
	}

	indexes := make([]string, 0, len(buckets))
	for index := range buckets {
		indexes = append(indexes, index)
	}
	// Events read in the order they happened, and the index is that order.
	sort.Slice(indexes, func(i, j int) bool {
		a, errA := strconv.Atoi(indexes[i])
		b, errB := strconv.Atoi(indexes[j])
		if errA != nil || errB != nil {
			return indexes[i] < indexes[j]
		}
		return a < b
	})

	logs := []JaegerLog{}
	for _, index := range indexes {
		b := buckets[index]
		fields := b.fields
		sortTags(fields)
		if b.name != "" {
			fields = append([]JaegerKeyValue{{Key: "event", Type: "string", Value: b.name}}, fields...)
		}
		timestamp, _ := nanosToMicros(b.nanos)
		logs = append(logs, JaegerLog{Timestamp: timestamp, Fields: fields})
	}
	return logs
}

func sortTags(tags []JaegerKeyValue) {
	sort.Slice(tags, func(i, j int) bool { return tags[i].Key < tags[j].Key })
}

// traceHasRoot reports whether the trace holds a span whose parent is not part
// of it — the span the waterfall hangs from.
//
// A trace still being ingested can arrive child-first, and until its root shows
// up the view has nothing to anchor to, which is what makes asking again worth
// doing.
func traceHasRoot(trace JaegerTrace) bool {
	if len(trace.Spans) == 0 {
		return false
	}
	ids := make(map[string]struct{}, len(trace.Spans))
	for _, span := range trace.Spans {
		ids[span.SpanID] = struct{}{}
	}
	for _, span := range trace.Spans {
		isRoot := true
		for _, ref := range span.References {
			if _, inTrace := ids[ref.SpanID]; inTrace {
				isRoot = false
				break
			}
		}
		if isRoot {
			return true
		}
	}
	return false
}
