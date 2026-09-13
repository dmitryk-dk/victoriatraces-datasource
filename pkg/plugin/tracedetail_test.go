package plugin

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildTraceSpansQuery(t *testing.T) {
	q := buildTraceSpansQuery("abc123")

	assert.Contains(t, q, `trace_id:"abc123"`)
	// A trace can be large; the cap is what keeps one runaway trace from
	// pulling the whole store into a browser.
	assert.Contains(t, q, "| limit 10000")
}

func TestParseTraceFromSpans(t *testing.T) {
	body := strings.Join([]string{
		`{"trace_id":"t1","span_id":"s1","name":"POST /order","duration":"25000000",` +
			`"start_time_unix_nano":"1700000000000000000","end_time_unix_nano":"1700000000025000000",` +
			`"kind":"2","status_code":"2","scope_name":"checkout-lib","scope_version":"1.2",` +
			`"resource_attr:service.name":"checkout","resource_attr:host.name":"box-1",` +
			`"span_attr:http.route":"/order",` +
			`"event:event_name:0":"exception","event:event_time_unix_nano:0":"1700000000010000000",` +
			`"event:event_attr:exception.type:0":"TimeoutError"}`,
		`{"trace_id":"t1","span_id":"s2","parent_span_id":"s1","name":"db.query",` +
			`"start_time_unix_nano":"1700000000005000000","end_time_unix_nano":"1700000000009000000",` +
			`"resource_attr:service.name":"postgres"}`,
	}, "\n")

	trace, err := parseTraceFromSpans("t1", strings.NewReader(body))
	require.NoError(t, err)

	require.Len(t, trace.Spans, 2)
	assert.Equal(t, "t1", trace.TraceID)

	root := trace.Spans[0]
	assert.Equal(t, "s1", root.SpanID)
	assert.Equal(t, "POST /order", root.OperationName)
	assert.Equal(t, "checkout", root.ProcessID)
	// Jaeger's units are microseconds; the store reports nanoseconds.
	assert.Equal(t, int64(1700000000000000), root.StartTime)
	assert.Equal(t, int64(25000), root.Duration)
	assert.Empty(t, root.References, "the root span has no parent")

	child := trace.Spans[1]
	require.Len(t, child.References, 1)
	assert.Equal(t, JaegerReference{RefType: "CHILD_OF", TraceID: "t1", SpanID: "s1"}, child.References[0])
	// No duration field: it comes from the span's own start and end.
	assert.Equal(t, int64(4000), child.Duration)

	t.Run("keeps span attributes as tags, without their prefix", func(t *testing.T) {
		assert.Contains(t, root.Tags, JaegerKeyValue{Key: "http.route", Type: "string", Value: "/order"})
	})

	t.Run("names the span kind and status the way the detail view reads them", func(t *testing.T) {
		assert.Contains(t, root.Tags, JaegerKeyValue{Key: "span.kind", Type: "string", Value: "server"})
		assert.Contains(t, root.Tags, JaegerKeyValue{Key: "otel.status_code", Type: "string", Value: "2"})
		assert.Contains(t, root.Tags, JaegerKeyValue{Key: "otel.scope.name", Type: "string", Value: "checkout-lib"})
	})

	t.Run("collects the resource attributes into the service's process", func(t *testing.T) {
		process, ok := trace.Processes["checkout"]
		require.True(t, ok)
		assert.Equal(t, "checkout", process.ServiceName)
		assert.Contains(t, process.Tags, JaegerKeyValue{Key: "host.name", Type: "string", Value: "box-1"})
	})

	t.Run("rebuilds a span's events from their indexed fields", func(t *testing.T) {
		require.Len(t, root.Logs, 1)
		assert.Equal(t, int64(1700000000010000), root.Logs[0].Timestamp)
		assert.Contains(t, root.Logs[0].Fields, JaegerKeyValue{Key: "event", Type: "string", Value: "exception"})
		assert.Contains(t, root.Logs[0].Fields, JaegerKeyValue{Key: "exception.type", Type: "string", Value: "TimeoutError"})
	})

	t.Run("skips lines that carry no span", func(t *testing.T) {
		trace, err := parseTraceFromSpans("t1", strings.NewReader("\n{\"trace_id\":\"t1\"}\nnot json\n"))
		require.NoError(t, err)
		assert.Empty(t, trace.Spans)
	})
}

func TestTraceHasRoot(t *testing.T) {
	// The waterfall hangs from a span whose parent is not in the trace. While
	// there is none the view has nothing to anchor to, which is what makes
	// asking again worth doing.
	child := JaegerSpan{SpanID: "s2", References: []JaegerReference{{SpanID: "s1", RefType: "CHILD_OF"}}}
	root := JaegerSpan{SpanID: "s1"}

	t.Run("a trace with no spans yet has nothing to anchor to", func(t *testing.T) {
		assert.False(t, traceHasRoot(JaegerTrace{}))
	})

	t.Run("every span having a parent inside the trace leaves no anchor", func(t *testing.T) {
		cycle := []JaegerSpan{
			{SpanID: "s1", References: []JaegerReference{{SpanID: "s2"}}},
			{SpanID: "s2", References: []JaegerReference{{SpanID: "s1"}}},
		}
		assert.False(t, traceHasRoot(JaegerTrace{Spans: cycle}))
	})

	t.Run("a span whose parent is missing anchors the trace", func(t *testing.T) {
		// A child that arrived before its parent still gives the view something
		// to draw, which is why this counts as rooted.
		assert.True(t, traceHasRoot(JaegerTrace{Spans: []JaegerSpan{child}}))
		assert.True(t, traceHasRoot(JaegerTrace{Spans: []JaegerSpan{child, root}}))
	})
}
