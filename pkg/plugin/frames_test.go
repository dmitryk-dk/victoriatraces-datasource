package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sampleTrace returns a minimal two-span trace for use in multiple tests.
func sampleTrace() JaegerTrace {
	return JaegerTrace{
		TraceID: "abc123",
		Processes: map[string]JaegerProcess{
			"p1": {ServiceName: "frontend"},
			"p2": {ServiceName: "database"},
		},
		Spans: []JaegerSpan{
			{
				TraceID:       "abc123",
				SpanID:        "span1",
				OperationName: "HTTP GET /api",
				References:    []JaegerReference{},
				StartTime:     1_000_000, // 1 000 000 us = 1000 ms
				Duration:      5_000,     // 5 000 us = 5 ms
				ProcessID:     "p1",
			},
			{
				TraceID:       "abc123",
				SpanID:        "span2",
				OperationName: "SELECT users",
				References: []JaegerReference{
					{RefType: "CHILD_OF", TraceID: "abc123", SpanID: "span1"},
				},
				StartTime: 1_001_000,
				Duration:  2_000,
				ProcessID: "p2",
				Tags: []JaegerKeyValue{
					{Key: "error", Type: "bool", Value: true},
				},
			},
		},
	}
}

// fieldVal looks up a field by name and returns its row-N value or fails the test.
func fieldVal(t *testing.T, f *data.Frame, name string, row int) interface{} {
	t.Helper()
	field, _ := f.FieldByName(name)
	require.NotNil(t, field, "missing field %q", name)
	return field.At(row)
}

func TestTracesToFrame(t *testing.T) {
	missingProcess := sampleTrace()
	missingProcess.Spans[0].ProcessID = "missing"

	tests := []struct {
		name   string
		traces []JaegerTrace
		check  func(t *testing.T, f *data.Frame)
	}{
		{
			name:   "row count equals total spans",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, 2, f.Rows())
			},
		},
		{
			name:   "field values preserved per span",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, "abc123", fieldVal(t, f, "traceID", 0))
				assert.Equal(t, "abc123", fieldVal(t, f, "traceID", 1))
				assert.Equal(t, "span1", fieldVal(t, f, "spanID", 0))
				assert.Equal(t, "span2", fieldVal(t, f, "spanID", 1))
				assert.Equal(t, "", fieldVal(t, f, "parentSpanID", 0), "root has empty parentSpanID")
				assert.Equal(t, "span1", fieldVal(t, f, "parentSpanID", 1))
				assert.Equal(t, "HTTP GET /api", fieldVal(t, f, "operationName", 0))
				assert.Equal(t, "SELECT users", fieldVal(t, f, "operationName", 1))
				assert.Equal(t, "frontend", fieldVal(t, f, "serviceName", 0))
				assert.Equal(t, "database", fieldVal(t, f, "serviceName", 1))
			},
		},
		{
			name:   "microseconds converted to milliseconds",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, float64(1000), fieldVal(t, f, "startTime", 0))
				assert.Equal(t, float64(5), fieldVal(t, f, "duration", 0))
			},
		},
		{
			name:   "frame meta is a trace visualization",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				require.NotNil(t, f.Meta)
				assert.Equal(t, "trace", string(f.Meta.PreferredVisualization))
			},
		},
		{
			name:   "empty input yields empty frame",
			traces: nil,
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, 0, f.Rows())
			},
		},
		{
			name:   "unknown process falls back to 'unknown'",
			traces: []JaegerTrace{missingProcess},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, "unknown", fieldVal(t, f, "serviceName", 0))
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			frame := TracesToFrame(tc.traces)
			require.NotNil(t, frame)
			tc.check(t, frame)
		})
	}
}

func TestTraceSearchResultToFrame(t *testing.T) {
	tests := []struct {
		name   string
		traces []JaegerTrace
		check  func(t *testing.T, f *data.Frame)
	}{
		{
			name:   "one row per trace",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, 1, f.Rows())
			},
		},
		{
			name:   "root span detected from references",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, "frontend", fieldVal(t, f, "rootServiceName", 0))
				assert.Equal(t, "HTTP GET /api", fieldVal(t, f, "rootTraceName", 0))
			},
		},
		{
			name:   "trace name combines service and operation",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, "frontend: HTTP GET /api", fieldVal(t, f, "traceName", 0))
			},
		},
		{
			name:   "duration is positive float64 ms",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				val, ok := fieldVal(t, f, "traceDuration", 0).(float64)
				require.True(t, ok, "traceDuration should be float64")
				assert.Greater(t, val, float64(0))
			},
		},
		{
			name:   "span count totals all spans",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, int64(2), fieldVal(t, f, "spanCount", 0))
			},
		},
		{
			name:   "empty input yields empty frame",
			traces: nil,
			check: func(t *testing.T, f *data.Frame) {
				assert.Equal(t, 0, f.Rows())
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			frame := TraceSearchResultToFrame(tc.traces)
			require.NotNil(t, frame)
			tc.check(t, frame)
		})
	}
}

func TestTraceToNodeGraphFrames(t *testing.T) {
	tests := []struct {
		name   string
		traces []JaegerTrace
		check  func(t *testing.T, nodes, edges *data.Frame)
	}{
		{
			name:   "one node per service, one edge per cross-service call",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, nodes, edges *data.Frame) {
				assert.Equal(t, 2, nodes.Rows(), "one node per service")
				assert.Equal(t, 1, edges.Rows(), "one edge for CHILD_OF cross-service call")
			},
		},
		{
			name:   "both frames carry nodeGraph meta",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, nodes, edges *data.Frame) {
				require.NotNil(t, nodes.Meta)
				assert.Equal(t, "nodeGraph", string(nodes.Meta.PreferredVisualization))
				require.NotNil(t, edges.Meta)
				assert.Equal(t, "nodeGraph", string(edges.Meta.PreferredVisualization))
			},
		},
		{
			name:   "nodes frame has the required node-graph fields",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, nodes, _ *data.Frame) {
				for _, name := range []string{"id", "title", "subtitle", "mainstat", "secondarystat", "arc__success", "arc__errors"} {
					f, _ := nodes.FieldByName(name)
					assert.NotNil(t, f, "nodes frame should have field %q", name)
				}
			},
		},
		{
			name:   "edges frame has the required node-graph fields",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, _, edges *data.Frame) {
				for _, name := range []string{"id", "source", "target", "mainstat", "secondarystat"} {
					f, _ := edges.FieldByName(name)
					assert.NotNil(t, f, "edges frame should have field %q", name)
				}
			},
		},
		{
			name:   "empty input yields empty frames",
			traces: nil,
			check: func(t *testing.T, nodes, edges *data.Frame) {
				assert.Equal(t, 0, nodes.Rows())
				assert.Equal(t, 0, edges.Rows())
			},
		},
		{
			name:   "error rate is per-service span fraction",
			traces: []JaegerTrace{sampleTrace()},
			check: func(t *testing.T, nodes, _ *data.Frame) {
				idField, _ := nodes.FieldByName("id")
				errField, _ := nodes.FieldByName("arc__errors")
				for i := 0; i < nodes.Rows(); i++ {
					id := idField.At(i).(string)
					errRate := errField.At(i).(float64)
					switch id {
					case "database":
						assert.Equal(t, float64(1), errRate, "database error rate should be 100%%")
					case "frontend":
						assert.Equal(t, float64(0), errRate, "frontend has no errors")
					}
				}
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			nodes, edges := TraceToNodeGraphFrames(tc.traces)
			require.NotNil(t, nodes)
			require.NotNil(t, edges)
			tc.check(t, nodes, edges)
		})
	}
}
