package plugin

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// heatmapEdgesNs are the duration bin boundaries, in nanoseconds. They step
// roughly 3x apart so the grid covers microseconds to tens of seconds in a
// readable number of rows.
var heatmapEdgesNs = []int64{
	3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 1e10, 3e10,
}

// heatmapYBins is one row per gap between edges, plus the open-ended rows below
// the first edge and above the last.
var heatmapYBins = len(heatmapEdgesNs) + 1

// heatmapTimeBuckets is the target number of columns. The actual step is
// derived from the range, so a short range yields wider buckets rather than
// more of them.
const heatmapTimeBuckets = 120

// rootSpanOnly selects the span that spans the whole trace.
const rootSpanOnly = "-parent_span_id:*"

// HeatmapCell is one populated grid cell. Empty cells are omitted rather than
// sent as zeros, which keeps a mostly-idle grid small.
type HeatmapCell struct {
	// Xi is the time-bucket index, Yi the duration-bin index.
	Xi     int   `json:"xi"`
	Yi     int   `json:"yi"`
	Count  int64 `json:"count"`
	Errors int64 `json:"errors"`
}

// HeatmapData is the grid plus the axis metadata needed to label it.
type HeatmapData struct {
	Cells []HeatmapCell `json:"cells"`
	// XCount is the number of time buckets, StepMs their width.
	XCount  int     `json:"xCount"`
	StepMs  int64   `json:"stepMs"`
	StartMs int64   `json:"startMs"`
	YEdges  []int64 `json:"yEdgesNs"`
}

// heatmapDurationCond is the LogsQL condition selecting bin k.
func heatmapDurationCond(k int) string {
	switch {
	case k == 0:
		return fmt.Sprintf("duration:<%d", heatmapEdgesNs[0])
	case k == len(heatmapEdgesNs):
		return fmt.Sprintf("duration:>=%d", heatmapEdgesNs[len(heatmapEdgesNs)-1])
	default:
		return fmt.Sprintf("duration:>=%d duration:<%d", heatmapEdgesNs[k-1], heatmapEdgesNs[k])
	}
}

// entityKind is what a row of the list below the chart stands for.
type entityKind string

const (
	entityTraces entityKind = "traces"
	entitySpans  entityKind = "spans"
)

// parseEntity reads the list's entity from a request, defaulting to traces.
func parseEntity(raw string) entityKind {
	if raw == string(entitySpans) {
		return entitySpans
	}
	return entityTraces
}

// buildHeatmapQuery counts traces per (time bucket, duration bin), plus how
// many of them contain an error.
//
// count_uniq(trace_id) rather than count(): a trace can map to more than one
// root-span row (duplicate ingestion, two roots, an empty parent_span_id), and
// a plain count would then disagree with the trace list below the chart.
func buildHeatmapQuery(where string, stepSeconds int64, entity entityKind) string {
	if where == "" {
		where = defaultTraceListWhere
	}

	// What the chart counts has to be what the list below it shows.
	//
	// Over traces: root spans only, because the y axis is trace duration and
	// counting every span would put one trace in several duration bins; and
	// distinct trace ids, because `count()` over-counts a trace that maps to
	// more than one root span. Over spans: every span counts once, and a span
	// either failed or it did not — there is no trace to look inside.
	countFn := "count_uniq(trace_id)"
	errorCond := traceContainsSubqueryGo("status_code:2")
	if entity == entitySpans {
		countFn = "count()"
		errorCond = "status_code:2"
	} else {
		where += " AND " + rootSpanOnly
	}

	clauses := make([]string, 0, heatmapYBins*2)
	for k := 0; k < heatmapYBins; k++ {
		cond := heatmapDurationCond(k)
		clauses = append(clauses, fmt.Sprintf("%s if (%s) b%d", countFn, cond, k))
		clauses = append(clauses, fmt.Sprintf("%s if (%s %s) e%d", countFn, cond, errorCond, k))
	}

	return fmt.Sprintf("%s | stats by (_time:%ds) %s", where, stepSeconds, strings.Join(clauses, ", "))
}

// traceContainsSubqueryGo lifts a span-level condition to the trace level, so a
// filter keeps the trace's other spans too.
func traceContainsSubqueryGo(cond string) string {
	return fmt.Sprintf("trace_id:in(span_id:* AND %s | fields trace_id)", cond)
}

// heatmapStepSeconds picks a bucket width that yields about heatmapTimeBuckets
// columns, never finer than one second.
func heatmapStepSeconds(startMs, endMs int64) int64 {
	span := (endMs - startMs) / 1000
	if span <= 0 {
		return 1
	}
	// Rounded, not truncated: flooring biases every range towards narrower
	// buckets than the target count asks for.
	step := (span + heatmapTimeBuckets/2) / heatmapTimeBuckets
	if step < 1 {
		return 1
	}
	return step
}

// heatmapBucket is one parsed stats row, kept until the grid origin is known.
type heatmapBucket struct {
	ms  int64
	row map[string]string
}

// floorDiv divides rounding towards negative infinity, unlike Go's `/`, which
// truncates towards zero and so maps -1 and +1 onto the same bucket.
func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

// heatmapOrigin is the start of the bucket containing startMs.
//
// `stats by (_time:Ns)` aligns buckets to absolute time, not to the query
// window, so the first bucket usually begins before startMs. phaseMs carries
// that alignment, read from a returned bucket; indexing off startMs instead
// would fold the leading bucket onto the same column as the one after it.
func heatmapOrigin(startMs, stepMs, phaseMs int64) int64 {
	return floorDiv(startMs-phaseMs, stepMs)*stepMs + phaseMs
}

// parseHeatmap turns the NDJSON stats rows into grid cells.
func parseHeatmap(body io.Reader, startMs, endMs, stepMs int64) (*HeatmapData, error) {
	data := &HeatmapData{
		Cells:   []HeatmapCell{},
		StepMs:  stepMs,
		StartMs: startMs,
		YEdges:  heatmapEdgesNs,
	}
	if stepMs <= 0 {
		return data, nil
	}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxTraceListLineBytes)

	// The grid's phase is only known once a bucket has been seen, so the rows
	// are collected first. There is one per time bucket, ~120 of them.
	buckets := make([]heatmapBucket, 0, heatmapTimeBuckets)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]string
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			continue
		}
		bucketMs, ok := parseHeatmapTime(row["_time"])
		if !ok {
			continue
		}
		buckets = append(buckets, heatmapBucket{ms: bucketMs, row: row})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading heatmap response: %w", err)
	}

	// With no rows the phase is unknowable; the epoch-aligned grid is the same
	// one the backend would have used.
	var phaseMs int64
	if len(buckets) > 0 {
		phaseMs = ((buckets[0].ms % stepMs) + stepMs) % stepMs
	}
	originMs := heatmapOrigin(startMs, stepMs, phaseMs)
	data.StartMs = originMs
	data.XCount = int(floorDiv(endMs-originMs, stepMs)) + 1

	for _, bucket := range buckets {
		xi := int(floorDiv(bucket.ms-originMs, stepMs))
		if xi < 0 || xi >= data.XCount {
			// A bucket from outside the requested window.
			continue
		}
		for k := 0; k < heatmapYBins; k++ {
			count, _ := strconv.ParseInt(bucket.row[fmt.Sprintf("b%d", k)], 10, 64)
			if count == 0 {
				continue
			}
			errs, _ := strconv.ParseInt(bucket.row[fmt.Sprintf("e%d", k)], 10, 64)
			data.Cells = append(data.Cells, HeatmapCell{Xi: xi, Yi: k, Count: count, Errors: errs})
		}
	}
	return data, nil
}

// parseHeatmapTime reads the RFC3339 bucket timestamp into epoch milliseconds.
func parseHeatmapTime(v string) (int64, bool) {
	if v == "" {
		return 0, false
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return 0, false
	}
	return t.UnixMilli(), true
}
