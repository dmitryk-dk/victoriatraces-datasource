package plugin

import (
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHeatmapDurationCond(t *testing.T) {
	t.Run("first bin is open below", func(t *testing.T) {
		assert.Equal(t, "duration:<3000", heatmapDurationCond(0))
	})

	t.Run("last bin is open above", func(t *testing.T) {
		assert.Equal(t, "duration:>=30000000000", heatmapDurationCond(len(heatmapEdgesNs)))
	})

	t.Run("middle bins are half-open so no duration lands twice", func(t *testing.T) {
		assert.Equal(t, "duration:>=3000 duration:<10000", heatmapDurationCond(1))
	})
}

func TestHeatmapStepSeconds(t *testing.T) {
	t.Run("aims for the target bucket count", func(t *testing.T) {
		// 2h across 120 buckets = 60s each.
		assert.Equal(t, int64(60), heatmapStepSeconds(0, 2*60*60*1000))
	})

	t.Run("rounds to the nearest step rather than always down", func(t *testing.T) {
		// 7290s across 120 buckets is 60.75s each; flooring gives columns that
		// are systematically narrower than the range asks for.
		assert.Equal(t, int64(61), heatmapStepSeconds(0, 7_290_000))
	})

	t.Run("never goes finer than a second", func(t *testing.T) {
		assert.Equal(t, int64(1), heatmapStepSeconds(0, 5_000))
	})

	t.Run("handles a zero or inverted range", func(t *testing.T) {
		assert.Equal(t, int64(1), heatmapStepSeconds(0, 0))
		assert.Equal(t, int64(1), heatmapStepSeconds(1000, 0))
	})
}

func TestBuildHeatmapQuery(t *testing.T) {
	q := buildHeatmapQuery("", 60, entityTraces)

	t.Run("buckets by the requested step", func(t *testing.T) {
		assert.Contains(t, q, "| stats by (_time:60s)")
	})

	t.Run("emits a count and an error count per duration bin", func(t *testing.T) {
		for k := 0; k < heatmapYBins; k++ {
			assert.Contains(t, q, "b"+strconv.Itoa(k))
			assert.Contains(t, q, "e"+strconv.Itoa(k))
		}
	})

	t.Run("counts distinct traces, not rows", func(t *testing.T) {
		// count() would disagree with the trace list when a trace has more
		// than one root-span row.
		assert.Contains(t, q, "count_uniq(trace_id)")
		assert.NotContains(t, q, "count() if")
	})

	t.Run("keeps a caller-supplied where clause", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(buildHeatmapQuery("status_code:2", 5, entityTraces), "status_code:2 AND "+rootSpanOnly))
	})

	t.Run("restricts the y axis to trace duration", func(t *testing.T) {
		// Without this a multi-span trace lands in several duration bins and
		// the chart totals no longer match the trace list.
		assert.Contains(t, q, rootSpanOnly)
	})
}

func TestBuildHeatmapQuerySpansMode(t *testing.T) {
	// In spans mode the list below the chart shows spans, so the chart has to
	// count spans too: counting distinct traces of root spans puts a number in
	// the cell that the list can never match.
	q := buildHeatmapQuery("status_code:2", 60, entitySpans)

	assert.Contains(t, q, "count() if (")
	assert.NotContains(t, q, "count_uniq(trace_id)")
	// A span either failed or it did not; there is no trace to look inside.
	assert.NotContains(t, q, "trace_id:in(")
	// Root spans are the trace's duration, not the span's, so spans mode keeps
	// every span.
	assert.NotContains(t, q, rootSpanOnly)
	assert.Contains(t, q, "| stats by (_time:60s)")
}

func TestParseHeatmap(t *testing.T) {
	const startMs = 1_700_000_000_000
	const stepMs = 60_000
	const endMs = startMs + 5*stepMs

	t.Run("maps rows onto grid coordinates", func(t *testing.T) {
		body := `{"_time":"2023-11-14T22:13:20Z","b3":"7","e3":"2"}`
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		require.Len(t, data.Cells, 1)
		assert.Equal(t, HeatmapCell{Xi: 0, Yi: 3, Count: 7, Errors: 2}, data.Cells[0])
	})

	t.Run("omits empty bins", func(t *testing.T) {
		body := `{"_time":"2023-11-14T22:13:20Z","b0":"0","b1":"4"}`
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		require.Len(t, data.Cells, 1)
		assert.Equal(t, 1, data.Cells[0].Yi)
	})

	t.Run("drops buckets outside the window", func(t *testing.T) {
		// The backend grid is aligned to absolute time, so an edge bucket can
		// fall before the requested start.
		body := `{"_time":"2020-01-01T00:00:00Z","b1":"4"}`
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		assert.Empty(t, data.Cells)
	})

	t.Run("keeps adjacent grid buckets in separate columns", func(t *testing.T) {
		// The stats grid is aligned to absolute time, so the first bucket
		// usually starts before the requested window. Indexing off startMs
		// folds it onto the same column as the bucket that follows it.
		body := strings.Join([]string{
			`{"_time":"2023-11-14T22:13:00Z","b1":"4"}`,
			`{"_time":"2023-11-14T22:14:00Z","b1":"9"}`,
		}, "\n")
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		require.Len(t, data.Cells, 2)
		assert.Equal(t, 0, data.Cells[0].Xi)
		assert.Equal(t, 1, data.Cells[1].Xi)
	})

	t.Run("reports the grid origin so column labels match the buckets", func(t *testing.T) {
		body := `{"_time":"2023-11-14T22:13:00Z","b1":"4"}`
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		// 22:13:00Z, the grid point at or before startMs (22:13:20Z).
		assert.Equal(t, int64(1_699_999_980_000), data.StartMs)
	})

	t.Run("keeps the last bucket of the window", func(t *testing.T) {
		// endMs is 22:18:20Z; the bucket covering it starts at 22:18:00Z.
		body := `{"_time":"2023-11-14T22:18:00Z","b1":"4"}`
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		require.Len(t, data.Cells, 1)
		assert.Equal(t, 5, data.Cells[0].Xi)
	})

	t.Run("skips malformed lines and timestamps", func(t *testing.T) {
		body := strings.Join([]string{
			`not json`,
			`{"b1":"4"}`,
			`{"_time":"nonsense","b1":"4"}`,
			`{"_time":"2023-11-14T22:13:20Z","b1":"4"}`,
		}, "\n")
		data, err := parseHeatmap(strings.NewReader(body), startMs, endMs, stepMs)
		require.NoError(t, err)
		assert.Len(t, data.Cells, 1)
	})

	t.Run("reports the axis metadata", func(t *testing.T) {
		data, err := parseHeatmap(strings.NewReader(""), startMs, endMs, stepMs)
		require.NoError(t, err)
		assert.Equal(t, 6, data.XCount)
		assert.Equal(t, int64(stepMs), data.StepMs)
		// With no rows to read the phase from, the epoch-aligned grid applies.
		assert.Equal(t, int64(1_699_999_980_000), data.StartMs)
		assert.Equal(t, heatmapEdgesNs, data.YEdges)
		assert.NotNil(t, data.Cells)
	})
}
