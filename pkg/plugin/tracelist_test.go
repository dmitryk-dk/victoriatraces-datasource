package plugin

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildTraceListQuery(t *testing.T) {
	t.Run("defaults the where clause and limit", func(t *testing.T) {
		q := buildTraceListQuery("", "", "", nil, 0)
		assert.True(t, strings.HasPrefix(q, defaultTraceListWhere+" | stats by (trace_id) "), q)
		assert.Contains(t, q, "| limit 50")
	})

	t.Run("keeps a caller-supplied where clause and limit", func(t *testing.T) {
		q := buildTraceListQuery(`"resource_attr:service.name":="checkout"`, "", "", nil, 10)
		assert.True(t, strings.HasPrefix(q, `"resource_attr:service.name":="checkout" | stats by (trace_id) `), q)
		assert.Contains(t, q, "| limit 10")
	})

	t.Run("aggregates every field the list columns need", func(t *testing.T) {
		q := buildTraceListQuery("", "", "", nil, 0)
		for _, want := range []string{
			"count() spans",
			"count() if (status_code:2) errors",
			`values("resource_attr:service.name") if (-parent_span_id:*) rootService`,
			"values(name) if (-parent_span_id:*) rootOperation",
			`uniq_values("resource_attr:service.name") svcAll`,
			"max(duration) if (-parent_span_id:*) durationNs",
			"min(_time) startTime",
		} {
			assert.Contains(t, q, want)
		}
	})

	t.Run("inserts the post-filter after the aggregation, before the sort", func(t *testing.T) {
		q := buildTraceListQuery("", "| filter spans:>=3", "", nil, 0)
		agg := strings.Index(q, "min(_time) startTime")
		pf := strings.Index(q, "| filter spans:>=3")
		sort := strings.Index(q, "| sort by")
		assert.Greater(t, pf, agg, q)
		assert.Less(t, pf, sort, q)
	})

	t.Run("omits the post-filter when empty", func(t *testing.T) {
		assert.NotContains(t, buildTraceListQuery("", "", "", nil, 0), "| filter")
	})

	t.Run("sorts newest first so paging walks backwards", func(t *testing.T) {
		assert.Contains(t, buildTraceListQuery("", "", "", nil, 0), "| sort by (startTime desc) |")
	})
}

func TestParseTraceListRows(t *testing.T) {
	t.Run("parses a complete row", func(t *testing.T) {
		line := `{"trace_id":"abc","spans":"3","errors":"1","rootService":"[\"frontend\"]",` +
			`"rootOperation":"[\"GET /\"]","svcAll":"[\"cart\",\"frontend\"]","opAll":"[\"GET /\"]",` +
			`"durationNs":"25000000","startTime":"2026-08-16T09:41:37.025Z"}`

		rows, err := parseTraceListRows(strings.NewReader(line), nil)
		require.NoError(t, err)
		require.Len(t, rows, 1)

		assert.Equal(t, "abc", rows[0].TraceID)
		assert.Equal(t, "frontend", rows[0].RootService)
		assert.Equal(t, "GET /", rows[0].RootOperation)
		assert.Equal(t, int64(25000), rows[0].DurationMicros)
		assert.Equal(t, 3, rows[0].Spans)
		assert.Equal(t, 1, rows[0].Errors)
		assert.False(t, rows[0].Partial)
		assert.Equal(t, "2026-08-16T09:41:37.025Z", rows[0].StartTime)
	})

	t.Run("puts the root service first in the chip order", func(t *testing.T) {
		line := `{"trace_id":"abc","rootService":"[\"frontend\"]","svcAll":"[\"cart\",\"frontend\",\"payments\"]"}`
		rows, err := parseTraceListRows(strings.NewReader(line), nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"frontend", "cart", "payments"}, rows[0].Services)
	})

	t.Run("marks a trace partial when its root span is out of range", func(t *testing.T) {
		// No rootService: the root span did not match the query window, so the
		// service and operation fall back to whatever the trace does contain.
		line := `{"trace_id":"abc","svcAll":"[\"cart\"]","opAll":"[\"HGET\"]",` +
			`"startMinNs":"1000000000","endMaxNs":"1000500000"}`
		rows, err := parseTraceListRows(strings.NewReader(line), nil)
		require.NoError(t, err)
		require.Len(t, rows, 1)

		assert.True(t, rows[0].Partial)
		assert.Equal(t, "cart", rows[0].RootService)
		assert.Equal(t, "HGET", rows[0].RootOperation)
		// Duration falls back to the span extent: 500000ns = 500µs.
		assert.Equal(t, int64(500), rows[0].DurationMicros)
	})

	t.Run("skips malformed lines and rows without a trace id", func(t *testing.T) {
		body := strings.Join([]string{
			`{"trace_id":"good","spans":"1"}`,
			`not json at all`,
			`{"spans":"9"}`,
			``,
			`{"trace_id":"also-good","spans":"2"}`,
		}, "\n")

		rows, err := parseTraceListRows(strings.NewReader(body), nil)
		require.NoError(t, err)
		require.Len(t, rows, 2)
		assert.Equal(t, "good", rows[0].TraceID)
		assert.Equal(t, "also-good", rows[1].TraceID)
	})

	t.Run("empty body yields an empty slice, not nil", func(t *testing.T) {
		rows, err := parseTraceListRows(strings.NewReader(""), nil)
		require.NoError(t, err)
		assert.NotNil(t, rows)
		assert.Empty(t, rows)
	})
}

func TestTraceListValueHelpers(t *testing.T) {
	t.Run("firstJSONValue", func(t *testing.T) {
		assert.Equal(t, "a", firstJSONValue(`["a","b"]`))
		assert.Equal(t, "", firstJSONValue(`[]`))
		assert.Equal(t, "", firstJSONValue(""))
		// Not an array — LogsQL returned a bare scalar.
		assert.Equal(t, "plain", firstJSONValue("plain"))
	})

	t.Run("allJSONValues", func(t *testing.T) {
		assert.Equal(t, []string{"a", "b"}, allJSONValues(`["a","b"]`))
		assert.Empty(t, allJSONValues(`[]`))
		assert.Nil(t, allJSONValues(""))
		assert.Equal(t, []string{"plain"}, allJSONValues("plain"))
	})

	t.Run("nanoStringToMicros", func(t *testing.T) {
		got, ok := nanoStringToMicros("25000000")
		require.True(t, ok)
		assert.Equal(t, int64(25000), got)

		_, ok = nanoStringToMicros("")
		assert.False(t, ok)

		_, ok = nanoStringToMicros("nope")
		assert.False(t, ok)

		// Beyond int64 nanoseconds; big.Int keeps this from wrapping.
		got, ok = nanoStringToMicros("92233720368547758070")
		require.True(t, ok)
		assert.Positive(t, got)
	})

	t.Run("extentMicros", func(t *testing.T) {
		got, ok := extentMicros("1000000000", "1000500000")
		require.True(t, ok)
		assert.Equal(t, int64(500), got)

		// End before start, or missing bounds, yield nothing.
		_, ok = extentMicros("1000500000", "1000000000")
		assert.False(t, ok)
		_, ok = extentMicros("", "1000000000")
		assert.False(t, ok)
	})
}

func TestTraceListRowsToFrame(t *testing.T) {
	rows := []TraceListRow{
		{
			TraceID:        "abc",
			RootService:    "frontend",
			RootOperation:  "GET /",
			Services:       []string{"frontend", "cart"},
			StartTime:      "2026-08-18T10:00:00Z",
			DurationMicros: 25_000,
			Spans:          3,
			Errors:         1,
			Partial:        false,
		},
	}

	t.Run("exposes every column the list renders", func(t *testing.T) {
		frame := TraceListRowsToFrame(rows, nil, "")
		names := make([]string, 0, len(frame.Fields))
		for _, f := range frame.Fields {
			names = append(names, f.Name)
		}
		assert.Equal(t, []string{
			"traceID", "rootService", "rootOperation", "services",
			"startTime", "durationMs", "spans", "errors", "matchedSpanID", "partial",
		}, names)
		assert.Equal(t, 1, frame.Rows())
	})

	t.Run("converts duration to milliseconds and time to a timestamp", func(t *testing.T) {
		frame := TraceListRowsToFrame(rows, nil, "")
		assert.Equal(t, 25.0, frame.Fields[5].At(0))
		assert.Equal(t, time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC), frame.Fields[4].At(0))
	})

	t.Run("carries the variable-length service set as JSON", func(t *testing.T) {
		frame := TraceListRowsToFrame(rows, nil, "")
		assert.Equal(t, `["frontend","cart"]`, frame.Fields[3].At(0))
	})

	t.Run("targets the custom trace panel", func(t *testing.T) {
		meta := TraceListRowsToFrame(rows, nil, "").Meta
		require.NotNil(t, meta)
		assert.Equal(t, "victoriametrics-traces-panel", meta.PreferredVisualizationPluginID)
	})

	t.Run("drops rows whose timestamp cannot be placed on the time axis", func(t *testing.T) {
		frame := TraceListRowsToFrame([]TraceListRow{{TraceID: "abc", StartTime: "not a time"}}, nil, "")
		assert.Equal(t, 0, frame.Rows())
	})

	t.Run("an empty service set stays valid JSON", func(t *testing.T) {
		frame := TraceListRowsToFrame([]TraceListRow{{TraceID: "abc", StartTime: "2026-08-18T10:00:00Z"}}, nil, "")
		assert.Equal(t, "[]", frame.Fields[3].At(0))
	})
}

func TestTraceListCustomFields(t *testing.T) {
	fields := []string{"span_attr:http.method", "resource_attr:k8s.pod.name"}

	t.Run("collects each field positionally from the root span", func(t *testing.T) {
		q := buildTraceListQuery("", "", "", fields, 0)
		assert.Contains(t, q, `values("span_attr:http.method") if (-parent_span_id:*) c0`)
		assert.Contains(t, q, `values("resource_attr:k8s.pod.name") if (-parent_span_id:*) c1`)
	})

	t.Run("quotes field names so they cannot inject syntax", func(t *testing.T) {
		q := buildTraceListQuery("", "", "", []string{`a"b`}, 0)
		assert.Contains(t, q, `values("a\"b")`)
	})

	t.Run("skips empty field names without shifting the others", func(t *testing.T) {
		q := buildTraceListQuery("", "", "", []string{"", "kind"}, 0)
		assert.NotContains(t, q, "c0")
		assert.Contains(t, q, `values("kind") if (-parent_span_id:*) c1`)
	})

	t.Run("maps positional columns back onto field names", func(t *testing.T) {
		line := `{"trace_id":"abc","c0":"[\"GET\"]","c1":"[\"pod-7\"]"}`
		rows, err := parseTraceListRows(strings.NewReader(line), fields)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		assert.Equal(t, map[string]string{
			"span_attr:http.method":      "GET",
			"resource_attr:k8s.pod.name": "pod-7",
		}, rows[0].Attrs)
	})

	t.Run("leaves attrs unset when a trace has no value for the field", func(t *testing.T) {
		rows, err := parseTraceListRows(strings.NewReader(`{"trace_id":"abc","c0":"[]"}`), fields)
		require.NoError(t, err)
		assert.Nil(t, rows[0].Attrs)
	})

	t.Run("adds one frame column per field, after the fixed ones", func(t *testing.T) {
		rows := []TraceListRow{{
			TraceID:   "abc",
			StartTime: "2026-08-18T10:00:00Z",
			Attrs:     map[string]string{"span_attr:http.method": "GET"},
		}}
		frame := TraceListRowsToFrame(rows, fields, "")

		names := make([]string, 0, len(frame.Fields))
		for _, f := range frame.Fields {
			names = append(names, f.Name)
		}
		assert.Equal(t, []string{"attr:span_attr:http.method", "attr:resource_attr:k8s.pod.name"}, names[len(names)-2:])

		attr := frame.Fields[len(frame.Fields)-2]
		assert.Equal(t, "GET", attr.At(0))
	})
}

func TestOperationStats(t *testing.T) {
	t.Run("aggregates a service's spans by operation name", func(t *testing.T) {
		q := buildOperationStatsQuery("checkout")
		assert.Contains(t, q, `"resource_attr:service.name":"checkout"`)
		assert.Contains(t, q, "| stats by (name) count() spans, avg(duration) avgDuration, count() if (status_code:2) errors")
		assert.Contains(t, q, "| sort by (spans desc)")
	})

	t.Run("quotes the service so it cannot inject syntax", func(t *testing.T) {
		assert.Contains(t, buildOperationStatsQuery(`a"b`), `"resource_attr:service.name":"a\"b"`)
	})

	t.Run("parses rows and converts the average to microseconds", func(t *testing.T) {
		body := `{"name":"POST /order","spans":"12","avgDuration":"25000000","errors":"3"}`
		stats, _, err := parseOperationStats(strings.NewReader(body))
		require.NoError(t, err)
		require.Len(t, stats, 1)
		assert.Equal(t, OperationStat{
			Operation:         "POST /order",
			Spans:             12,
			AvgDurationMicros: 25000,
			Errors:            3,
		}, stats[0])
	})

	t.Run("skips malformed lines and rows without a name", func(t *testing.T) {
		body := strings.Join([]string{`nonsense`, `{"spans":"4"}`, `{"name":"ok","spans":"1"}`}, "\n")
		stats, _, err := parseOperationStats(strings.NewReader(body))
		require.NoError(t, err)
		require.Len(t, stats, 1)
		assert.Equal(t, "ok", stats[0].Operation)
	})

	t.Run("empty body yields an empty slice, not nil", func(t *testing.T) {
		stats, _, err := parseOperationStats(strings.NewReader(""))
		require.NoError(t, err)
		assert.NotNil(t, stats)
		assert.Empty(t, stats)
	})
}

func TestSpanList(t *testing.T) {
	t.Run("selects spans newest first, without aggregating", func(t *testing.T) {
		q := buildSpanListQuery("status_code:2", 25)
		assert.Equal(t, "status_code:2 | sort by (_time) desc | limit 25", q)
		assert.NotContains(t, q, "stats by")
	})

	t.Run("defaults the where clause and limit", func(t *testing.T) {
		assert.Equal(t, defaultTraceListWhere+" | sort by (_time) desc | limit 50", buildSpanListQuery("", 0))
	})

	t.Run("parses a span row", func(t *testing.T) {
		line := `{"trace_id":"abc","span_id":"s1","resource_attr:service.name":"checkout",` +
			`"name":"POST /order","_time":"2026-08-25T10:00:00Z","duration":"25000000",` +
			`"kind":"2","status_code":"2"}`

		rows, err := parseSpanListRows(strings.NewReader(line), nil)
		require.NoError(t, err)
		require.Len(t, rows, 1)

		assert.Equal(t, SpanListRow{
			TraceID:        "abc",
			SpanID:         "s1",
			Service:        "checkout",
			Operation:      "POST /order",
			StartTime:      "2026-08-25T10:00:00Z",
			DurationMicros: 25000,
			Kind:           "2",
			StatusCode:     2,
		}, rows[0])
	})

	t.Run("reads custom fields straight off the span", func(t *testing.T) {
		// No aggregate here, so the field appears under its own name.
		line := `{"span_id":"s1","span_attr:http.status_code":"500"}`
		rows, err := parseSpanListRows(strings.NewReader(line), []string{"span_attr:http.status_code"})
		require.NoError(t, err)
		assert.Equal(t, map[string]string{"span_attr:http.status_code": "500"}, rows[0].Attrs)
	})

	t.Run("skips malformed lines and rows without a span id", func(t *testing.T) {
		body := strings.Join([]string{`nope`, `{"trace_id":"abc"}`, `{"span_id":"s1"}`}, "\n")
		rows, err := parseSpanListRows(strings.NewReader(body), nil)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		assert.Equal(t, "s1", rows[0].SpanID)
	})

	t.Run("builds a frame with the span-level columns", func(t *testing.T) {
		rows := []SpanListRow{{
			TraceID: "abc", SpanID: "s1", Service: "checkout", Operation: "POST /order",
			StartTime: "2026-08-25T10:00:00Z", DurationMicros: 25000, Kind: "2", StatusCode: 2,
		}}
		frame := SpanListRowsToFrame(rows, nil, "")

		names := make([]string, 0, len(frame.Fields))
		for _, f := range frame.Fields {
			names = append(names, f.Name)
		}
		assert.Equal(t, []string{
			"traceID", "spanID", "service", "operation", "startTime", "durationMs", "kind", "statusCode",
		}, names)
		assert.Equal(t, 25.0, frame.Fields[5].At(0))
	})

	t.Run("drops rows whose timestamp cannot be placed on the time axis", func(t *testing.T) {
		frame := SpanListRowsToFrame([]SpanListRow{{SpanID: "s1", StartTime: "nope"}}, nil, "")
		assert.Equal(t, 0, frame.Rows())
	})
}

func TestTraceListMatchedSpan(t *testing.T) {
	const cond = `"resource_attr:service.name":in("checkout")`

	t.Run("records which span satisfied the filter", func(t *testing.T) {
		q := buildTraceListQuery("", "", cond, nil, 0)
		assert.Contains(t, q, `values(span_id) if (`+cond+`) matchedSpan`)
	})

	t.Run("omits the clause when nothing was filtered on", func(t *testing.T) {
		assert.NotContains(t, buildTraceListQuery("", "", "", nil, 0), "matchedSpan")
	})

	t.Run("parses the matched span onto the row", func(t *testing.T) {
		line := `{"trace_id":"abc","matchedSpan":"[\"s7\"]"}`
		rows, err := parseTraceListRows(strings.NewReader(line), nil)
		require.NoError(t, err)
		assert.Equal(t, "s7", rows[0].MatchedSpanID)
	})

	t.Run("leaves it empty when the query did not ask", func(t *testing.T) {
		rows, err := parseTraceListRows(strings.NewReader(`{"trace_id":"abc"}`), nil)
		require.NoError(t, err)
		assert.Empty(t, rows[0].MatchedSpanID)
	})

	t.Run("exposes it as a frame column", func(t *testing.T) {
		rows := []TraceListRow{{TraceID: "abc", StartTime: "2026-08-25T10:00:00Z", MatchedSpanID: "s7"}}
		frame := TraceListRowsToFrame(rows, nil, "")
		field := frame.Fields[len(frame.Fields)-2]
		assert.Equal(t, "matchedSpanID", field.Name)
		assert.Equal(t, "s7", field.At(0))
	})
}

func TestFrameCarriesDatasourceUID(t *testing.T) {
	// The panel calls resource endpoints of its own, and Explore does not
	// reliably give it the datasource uid, so the frame carries it.
	rows := []TraceListRow{{TraceID: "abc", StartTime: "2026-09-01T10:00:00Z"}}

	t.Run("trace list", func(t *testing.T) {
		meta := TraceListRowsToFrame(rows, nil, "ds-uid").Meta
		require.NotNil(t, meta)
		assert.Equal(t, "ds-uid", meta.Custom.(map[string]interface{})["datasourceUid"])
	})

	t.Run("span list", func(t *testing.T) {
		spans := []SpanListRow{{SpanID: "s1", StartTime: "2026-09-01T10:00:00Z"}}
		meta := SpanListRowsToFrame(spans, nil, "ds-uid").Meta
		require.NotNil(t, meta)
		assert.Equal(t, "ds-uid", meta.Custom.(map[string]interface{})["datasourceUid"])
	})
}

func TestOperationStatsTruncation(t *testing.T) {
	t.Run("asks for one more row than it will show", func(t *testing.T) {
		// The extra row is how a truncated result is detected without a
		// second count query.
		assert.Contains(t, buildOperationStatsQuery("checkout"), fmt.Sprintf("| limit %d", operationStatsLimit+1))
	})

	t.Run("reports a complete result", func(t *testing.T) {
		body := `{"name":"GET /","spans":"5","avgDuration":"1000","errors":"0"}`
		stats, truncated, err := parseOperationStats(strings.NewReader(body))
		require.NoError(t, err)
		assert.False(t, truncated)
		assert.Len(t, stats, 1)
	})

	t.Run("trims and flags a result that hit the cap", func(t *testing.T) {
		lines := make([]string, 0, operationStatsLimit+1)
		for i := 0; i <= operationStatsLimit; i++ {
			lines = append(lines, fmt.Sprintf(`{"name":"op-%d","spans":"1","avgDuration":"1","errors":"0"}`, i))
		}
		stats, truncated, err := parseOperationStats(strings.NewReader(strings.Join(lines, "\n")))
		require.NoError(t, err)
		assert.True(t, truncated)
		assert.Len(t, stats, operationStatsLimit)
	})
}

func TestBuildTraceSampleQuery(t *testing.T) {
	t.Run("orders by trace id so the sample spreads across the range", func(t *testing.T) {
		// Ordering by time returns only the newest N, which on a busy source
		// is a few seconds' worth — every point lands on the right edge of the
		// scatter plot. visum samples by trace id for the same reason.
		q := buildTraceSampleQuery("", 1000)
		assert.Contains(t, q, "| sort by (trace_id) | limit 1000")
		assert.NotContains(t, q, "sort by (startTime desc)")
	})

	t.Run("aggregates the same per-trace fields as the list", func(t *testing.T) {
		q := buildTraceSampleQuery("", 1000)
		assert.Contains(t, q, "| stats by (trace_id)")
		assert.Contains(t, q, "max(duration) if (-parent_span_id:*) durationNs")
		assert.Contains(t, q, "min(_time) startTime")
	})

	t.Run("keeps a caller-supplied filter", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(buildTraceSampleQuery("status_code:2", 10), "status_code:2 |"))
	})
}

func TestBuildTraceCountQuery(t *testing.T) {
	t.Run("counts the traces the sample was drawn from", func(t *testing.T) {
		q := buildTraceCountQuery("")
		assert.Contains(t, q, "| stats by (trace_id)")
		assert.Contains(t, q, "| stats count() total")
	})
}

func TestParseTraceCount(t *testing.T) {
	t.Run("reads the total", func(t *testing.T) {
		total, err := parseTraceCount(strings.NewReader(`{"total":"4210"}`))
		require.NoError(t, err)
		assert.Equal(t, int64(4210), total)
	})

	t.Run("treats an empty body as zero", func(t *testing.T) {
		total, err := parseTraceCount(strings.NewReader(""))
		require.NoError(t, err)
		assert.Equal(t, int64(0), total)
	})
}
