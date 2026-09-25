package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func cancelledResponse(ctx context.Context, err error) (backend.DataResponse, bool) {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
		return backend.DataResponse{}, true
	}
	return backend.DataResponse{}, false
}

const (
	queryTypeSearch        = "search"
	queryTypeTraceList     = "traceList"
	queryTypeSpanList      = "spanList"
	queryTypeTraceID       = "traceId"
	queryTypeLogsQL        = "logsql"
	queryTypeLogsQLInstant = "logsql-instant"
	queryTypeLogsQLLogs    = "logsql-logs"
	queryTypeLogsQLHits    = "logsql-hits"

	defaultLogsQLInterval = 15 * time.Second
	defaultResolution     = int64(1500)
)

// queryModel maps the JSON sent by the frontend query editor.
type queryModel struct {
	QueryType     string `json:"queryType"`
	TraceID       string `json:"traceId"`
	ServiceName   string `json:"serviceName"`
	OperationName string `json:"operationName"`
	Tags          string `json:"tags"`
	Limit         int    `json:"limit"`
	// Search mode: Jaeger-style duration bounds, e.g. "100ms", "2s".
	MinDuration string `json:"minDuration"`
	MaxDuration string `json:"maxDuration"`
	// Trace-list mode: the LogsQL fragments the filter bar produced. Where is
	// applied to spans, PostFilter to the per-trace aggregate.
	Where      string `json:"where"`
	PostFilter string `json:"postFilter"`
	// CustomFields are extra span fields shown as list columns.
	CustomFields []string `json:"customFields"`
	// MatchCond records which span satisfied the service/operation filter.
	MatchCond string `json:"matchCond"`
	// LogsQL mode fields
	Expr           string   `json:"expr"`
	Step           string   `json:"step"`
	LegendFormat   string   `json:"legendFormat"`
	TimezoneOffset string   `json:"timezoneOffset"`
	Fields         []string `json:"fields"`
}

// handleQuery dispatches a single DataQuery to the appropriate handler.
func (d *Datasource) handleQuery(ctx context.Context, query backend.DataQuery, dsUID string) backend.DataResponse {
	var qm queryModel
	if err := json.Unmarshal(query.JSON, &qm); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("parsing query: %v", err))
	}

	switch qm.QueryType {
	case queryTypeTraceID:
		return d.queryTrace(ctx, query, qm, dsUID)
	case queryTypeTraceList:
		return d.queryTraceList(ctx, query, qm, dsUID)
	case queryTypeSpanList:
		return d.querySpanList(ctx, query, qm, dsUID)
	case queryTypeLogsQL:
		return d.queryLogsQL(ctx, query, qm)
	case queryTypeLogsQLInstant:
		return d.queryLogsQLInstant(ctx, query, qm)
	case queryTypeLogsQLLogs:
		return d.queryLogsQLLogs(ctx, query, qm)
	case queryTypeLogsQLHits:
		return d.queryLogsQLHits(ctx, query, qm)
	default:
		return d.querySearch(ctx, query, qm)
	}
}

func (d *Datasource) queryTrace(ctx context.Context, query backend.DataQuery, qm queryModel, dsUID string) backend.DataResponse {
	if qm.TraceID == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "traceId is required")
	}

	// The stored spans, not the Jaeger API: the same source the trace-detail
	// resource reads, so a trace one of them can show the other can too, and a
	// trace still being ingested comes back partial rather than as an error.
	body, err := d.client.QueryLogsQLStream(
		ctx,
		buildTraceSpansQuery(qm.TraceID),
		query.TimeRange.From.Format(time.RFC3339Nano),
		query.TimeRange.To.Format(time.RFC3339Nano),
	)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("fetching trace: %v", err))
	}
	trace, err := parseTraceFromSpans(qm.TraceID, body)
	closeBody(body)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("parsing trace: %v", err))
	}
	if len(trace.Spans) == 0 {
		return backend.ErrDataResponse(backend.StatusNotFound, fmt.Sprintf("trace %q not found — it may have expired or not yet been ingested", qm.TraceID))
	}
	traces := []JaegerTrace{trace}

	traceFrame := TracesToFrame(traces, dsUID)
	nodesFrame, edgesFrame := TraceToNodeGraphFrames(traces)
	return backend.DataResponse{Frames: data.Frames{traceFrame, nodesFrame, edgesFrame}}
}

func (d *Datasource) queryLogsQL(ctx context.Context, query backend.DataQuery, qm queryModel) backend.DataResponse {
	if qm.Expr == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "expr is required for logsql query type")
	}

	expr := replaceIntervalVars(qm.Expr, query.Interval, query.TimeRange)

	step := qm.Step
	if step == "" {
		step = logsQLFormatDuration(calculateLogsQLStep(query.Interval, query.TimeRange, query.MaxDataPoints))
	}

	resp, err := d.client.QueryLogsQLRange(ctx, expr, query.TimeRange.From, query.TimeRange.To, step, qm.TimezoneOffset)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql query: %v", err))
	}
	if resp.Status != "success" {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql error: %s", resp.Error))
	}

	frames, err := resp.getDataFrames()
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("parsing logsql response: %v", err))
	}
	intervalMs := query.Interval.Milliseconds()
	for _, frame := range frames {
		addMetadataToFrame(frame, qm.LegendFormat, qm.Expr)
		addIntervalToFrame(frame, intervalMs)
	}
	return backend.DataResponse{Frames: frames}
}

func (d *Datasource) queryLogsQLInstant(ctx context.Context, query backend.DataQuery, qm queryModel) backend.DataResponse {
	if qm.Expr == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "expr is required for logsql-instant query type")
	}

	// stats_query has no start/end params — the time range must be embedded in the
	// filter part of the expression (before the first |). Add it automatically if missing,
	// matching what the VictoriaLogs datasource does via AddTimeFieldWithRange.
	expr := replaceIntervalVars(qm.Expr, query.Interval, query.TimeRange)
	expr = addTimeFieldIfMissing(expr, query.TimeRange)

	resp, err := d.client.QueryLogsQLInstant(ctx, expr, query.TimeRange.To, qm.TimezoneOffset)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql instant query: %v", err))
	}
	if resp.Status != "success" {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql instant error: %s", resp.Error))
	}

	frames, err := resp.getDataFrames()
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("parsing logsql instant response: %v", err))
	}
	for _, frame := range frames {
		addMetadataToFrame(frame, qm.LegendFormat, qm.Expr)
	}
	return backend.DataResponse{Frames: frames}
}

func (d *Datasource) queryLogsQLLogs(ctx context.Context, query backend.DataQuery, qm queryModel) backend.DataResponse {
	if qm.Expr == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "expr is required for logsql-logs query type")
	}

	expr := replaceIntervalVars(qm.Expr, query.Interval, query.TimeRange)

	limit := qm.Limit
	if limit <= 0 {
		limit = defaultLogsLimit
	}

	body, err := d.client.QueryLogsQLLogs(ctx, expr, query.TimeRange.From, query.TimeRange.To, limit, qm.TimezoneOffset)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql logs query: %v", err))
	}
	defer closeBody(body)

	return parseLogsResponse(body)
}

func (d *Datasource) queryLogsQLHits(ctx context.Context, query backend.DataQuery, qm queryModel) backend.DataResponse {
	if qm.Expr == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "expr is required for logsql-hits query type")
	}

	expr := replaceIntervalVars(qm.Expr, query.Interval, query.TimeRange)

	step := qm.Step
	if step == "" {
		step = logsQLFormatDuration(calculateLogsQLStep(query.Interval, query.TimeRange, query.MaxDataPoints))
	}

	body, err := d.client.QueryLogsQLHits(ctx, expr, query.TimeRange.From, query.TimeRange.To, step, qm.TimezoneOffset, qm.Fields)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("logsql hits query: %v", err))
	}
	defer closeBody(body)

	return parseHitsResponse(body)
}

// logsStats holds the unmarshalled result array from a LogsQL stats response.
type logsStats struct {
	Result []LogsQLResult
}

// getDataFrames dispatches on the ResultType field in the response body ("vector" or "matrix"),
// matching the approach used in the VictoriaLogs datasource.
func (r *LogsQLResponse) getDataFrames() (data.Frames, error) {
	var ls logsStats
	if err := json.Unmarshal(r.Data.Result, &ls.Result); err != nil {
		return nil, fmt.Errorf("unmarshal result: %w", err)
	}
	switch r.Data.ResultType {
	case "vector":
		return ls.vectorDataFrames()
	case "matrix":
		return ls.matrixDataFrames()
	default:
		return nil, fmt.Errorf("unknown resultType %q", r.Data.ResultType)
	}
}

// vectorDataFrames builds one Grafana frame per series for a Prometheus vector response
// (stats_query — single point in time, for Stat/Table panels).
func (ls logsStats) vectorDataFrames() (data.Frames, error) {
	frames := make(data.Frames, 0, len(ls.Result))
	for _, res := range ls.Result {
		if len(res.Value) < 2 {
			continue
		}
		ts, err := logsQLTimestamp(res.Value[0])
		if err != nil {
			return nil, fmt.Errorf("failed to parse timestamp for metric %v: %w", res, err)
		}
		fPtr, err := logsQLFloat(res.Value[1])
		if err != nil {
			return nil, fmt.Errorf("failed to parse value for metric %v: %w", res, err)
		}
		labels := stripMetricName(data.Labels(res.Labels))
		frames = append(frames, data.NewFrame("",
			data.NewField(data.TimeSeriesTimeFieldName, nil, []time.Time{ts}),
			data.NewField(data.TimeSeriesValueFieldName, labels, []*float64{fPtr}),
		))
	}
	return frames, nil
}

// matrixDataFrames builds one Grafana frame per series for a Prometheus matrix response
// (stats_query_range — time series, for Graph/TimeSeries panels).
func (ls logsStats) matrixDataFrames() (data.Frames, error) {
	frames := make(data.Frames, 0, len(ls.Result))
	for _, res := range ls.Result {
		timestamps := make([]time.Time, 0, len(res.Values))
		values := make([]*float64, 0, len(res.Values))

		for _, v := range res.Values {
			ts, err := logsQLTimestamp(v[0])
			if err != nil {
				return nil, fmt.Errorf("failed to parse timestamp for metric %v: %w", res, err)
			}
			fPtr, err := logsQLFloat(v[1])
			if err != nil {
				return nil, fmt.Errorf("failed to parse value for metric %v: %w", res, err)
			}
			timestamps = append(timestamps, ts)
			values = append(values, fPtr)
		}

		labels := stripMetricName(data.Labels(res.Labels))
		frames = append(frames, data.NewFrame("",
			data.NewField(data.TimeSeriesTimeFieldName, nil, timestamps),
			data.NewField(data.TimeSeriesValueFieldName, labels, values),
		))
	}
	return frames, nil
}

// stripMetricName removes the __name__ label from a label set.
// The __name__ label (e.g. "total" from `count() total`) creates a spurious
// column in makeTableFrames that confuses bar chart x-axis grouping.
func stripMetricName(labels data.Labels) data.Labels {
	if _, ok := labels["__name__"]; !ok {
		return labels
	}
	cleaned := make(data.Labels, len(labels)-1)
	for k, v := range labels {
		if k != "__name__" {
			cleaned[k] = v
		}
	}
	return cleaned
}

// addMetadataToFrame applies the legend format to the value field's DisplayNameFromDS
// and sets the frame name. Mirrors Query.addMetadataToMultiFrame in VictoriaLogs.
func addMetadataToFrame(frame *data.Frame, legendFormat, expr string) {
	if len(frame.Fields) < 2 {
		return
	}
	name := parseLegend(legendFormat, frame.Fields[1].Labels, expr)
	if name != "" {
		if frame.Fields[1].Config == nil {
			frame.Fields[1].Config = &data.FieldConfig{}
		}
		frame.Fields[1].Config.DisplayNameFromDS = name
		frame.Name = name
	}
}

// addIntervalToFrame sets Config.Interval on the time field so Grafana renders
// bar widths correctly. Mirrors Query.addIntervalToFrame in VictoriaLogs.
func addIntervalToFrame(frame *data.Frame, intervalMs int64) {
	if len(frame.Fields) == 0 || intervalMs <= 0 {
		return
	}
	if frame.Fields[0].Config == nil {
		frame.Fields[0].Config = &data.FieldConfig{}
	}
	frame.Fields[0].Config.Interval = float64(intervalMs)
}

// replaceIntervalVars substitutes Grafana's built-in time template variables in a
// LogsQL expression before it is sent to the backend, matching VictoriaLogs' behaviour.
//   - $__interval     → e.g. "30s"
//   - $__interval_ms  → e.g. "30000"
//   - $__range        → e.g. "[1712700000, 1712786400]"
func replaceIntervalVars(expr string, interval time.Duration, tr backend.TimeRange) string {
	ms := interval.Milliseconds()
	if ms <= 0 {
		ms = defaultLogsQLInterval.Milliseconds()
		interval = defaultLogsQLInterval
	}
	expr = strings.ReplaceAll(expr, "$__interval_ms", strconv.FormatInt(ms, 10))
	expr = strings.ReplaceAll(expr, "$__interval", logsQLFormatDuration(interval))
	timeRange := fmt.Sprintf("[%d, %d]", tr.From.Unix(), tr.To.Unix())
	expr = strings.ReplaceAll(expr, "$__range", timeRange)
	return expr
}

// addTimeFieldIfMissing prepends a `_time:[start, end]` filter to the LogsQL
// expression when none is already present. This is required for stats_query
// (instant) because that endpoint has no start/end parameters — the time range
// must live inside the query itself. Mirrors VictoriaLogs' AddTimeFieldWithRange.
func addTimeFieldIfMissing(expr string, tr backend.TimeRange) string {
	// Only inspect the filter part (before the first pipe).
	filterPart := expr
	if idx := strings.Index(expr, "|"); idx >= 0 {
		filterPart = expr[:idx]
	}
	if strings.Contains(filterPart, "_time:") {
		return expr
	}
	timeFilter := fmt.Sprintf("_time:[%d, %d]", tr.From.Unix(), tr.To.Unix())
	return timeFilter + " " + strings.TrimSpace(expr)
}

var legendReplacer = regexp.MustCompile(`\{\{\s*(.+?)\s*\}\}`)

// parseLegend applies a legendFormat template to metric labels.
// Supports {{ label_name }} placeholders. Falls back to label-set string when empty.
func parseLegend(legendFormat string, labels data.Labels, expr string) string {
	if legendFormat == "" {
		if len(labels) == 0 {
			return expr
		}
		parts := make([]string, 0, len(labels))
		for k, v := range labels {
			parts = append(parts, fmt.Sprintf(`%s="%s"`, k, v))
		}
		sort.Strings(parts)
		return "{" + strings.Join(parts, ",") + "}"
	}
	result := legendReplacer.ReplaceAllStringFunc(legendFormat, func(match string) string {
		sub := legendReplacer.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		if val, ok := labels[strings.TrimSpace(sub[1])]; ok {
			return val
		}
		return ""
	})
	if strings.TrimSpace(result) == "" {
		return expr
	}
	return result
}

// calculateLogsQLStep determines the step duration for stats_query_range.
// It respects Grafana's calculated interval (from $__interval) and rounds to
// a human-friendly value using the same table as VictoriaLogs.
func calculateLogsQLStep(interval time.Duration, timeRange backend.TimeRange, maxDataPoints int64) time.Duration {
	minInterval := interval
	if minInterval <= 0 {
		minInterval = defaultLogsQLInterval
	}

	resolution := maxDataPoints
	if resolution == 0 {
		resolution = defaultResolution
	}

	rangeNs := timeRange.To.UnixNano() - timeRange.From.UnixNano()
	calculated := time.Duration(rangeNs / resolution)

	if calculated < minInterval {
		return roundLogsQLInterval(minInterval)
	}
	return roundLogsQLInterval(calculated)
}

func logsQLFormatDuration(d time.Duration) string {
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("%dd", d/(24*time.Hour))
	case d >= time.Hour:
		return fmt.Sprintf("%dh", d/time.Hour)
	case d >= time.Minute:
		return fmt.Sprintf("%dm", d/time.Minute)
	case d >= time.Second:
		return fmt.Sprintf("%ds", d/time.Second)
	case d >= time.Millisecond:
		return fmt.Sprintf("%dms", d/time.Millisecond)
	default:
		return "1ms"
	}
}

// roundLogsQLInterval snaps a duration to the nearest human-friendly step,
// matching the table used by VictoriaLogs datasource.
func roundLogsQLInterval(d time.Duration) time.Duration {
	ms := d.Milliseconds()
	switch {
	case ms <= 10:
		return time.Millisecond
	case ms < 15:
		return 10 * time.Millisecond
	case ms < 35:
		return 20 * time.Millisecond
	case ms < 75:
		return 50 * time.Millisecond
	case ms < 150:
		return 100 * time.Millisecond
	case ms < 350:
		return 200 * time.Millisecond
	case ms < 750:
		return 500 * time.Millisecond
	case ms < 1500:
		return time.Second
	case ms < 3500:
		return 2 * time.Second
	case ms < 7500:
		return 5 * time.Second
	case ms < 12500:
		return 10 * time.Second
	case ms < 17500:
		return 15 * time.Second
	case ms < 25000:
		return 20 * time.Second
	case ms < 45000:
		return 30 * time.Second
	case ms < 90000:
		return time.Minute
	case ms < 210000:
		return 2 * time.Minute
	case ms < 450000:
		return 5 * time.Minute
	case ms < 750000:
		return 10 * time.Minute
	case ms < 1050000:
		return 15 * time.Minute
	case ms < 1500000:
		return 20 * time.Minute
	case ms < 2700000:
		return 30 * time.Minute
	case ms < 5400000:
		return time.Hour
	case ms < 9000000:
		return 2 * time.Hour
	case ms < 16200000:
		return 3 * time.Hour
	case ms < 32400000:
		return 6 * time.Hour
	case ms < 86400000:
		return 12 * time.Hour
	case ms < 172800000:
		return 24 * time.Hour
	case ms < 604800000:
		return 24 * time.Hour
	case ms < 1814400000:
		return 7 * 24 * time.Hour
	case ms < 3628800000:
		return 30 * 24 * time.Hour
	default:
		return 365 * 24 * time.Hour
	}
}

func logsQLTimestamp(v interface{}) (time.Time, error) {
	f, ok := v.(float64)
	if !ok {
		return time.Time{}, fmt.Errorf("timestamp is not a number: %v", v)
	}
	sec := int64(f)
	nsec := int64((f - float64(sec)) * 1e9)
	return time.Unix(sec, nsec), nil
}

func logsQLFloat(v interface{}) (*float64, error) {
	s, ok := v.(string)
	if !ok {
		return nil, fmt.Errorf("value is not a string: %v", v)
	}
	if s == "" {
		return nil, nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil, fmt.Errorf("parsing float %q: %w", s, err)
	}
	return &f, nil
}

// querySpanList lists individual spans rather than traces.
func (d *Datasource) querySpanList(ctx context.Context, query backend.DataQuery, qm queryModel, dsUID string) backend.DataResponse {
	limit := qm.Limit
	if limit <= 0 {
		limit = defaultTraceListLimit
	}

	body, err := d.client.QuerySpanList(
		ctx,
		qm.Where,
		limit,
		query.TimeRange.From.Format(time.RFC3339Nano),
		query.TimeRange.To.Format(time.RFC3339Nano),
	)
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("listing spans: %v", err))
	}
	defer closeBody(body)

	rows, err := parseSpanListRows(body, qm.CustomFields)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("parsing span list: %v", err))
	}

	frames := data.Frames{
		TraceChartsFrame(dsUID),
		SpanListRowsToFrame(rows, qm.CustomFields, dsUID),
	}
	for _, frame := range frames {
		withQueryContext(frame, query.JSON)
	}
	return backend.DataResponse{Frames: frames}
}

// queryTraceList runs the per-trace LogsQL aggregation behind the trace list.
//
// The time bounds come from Grafana's range rather than a paging cursor: in
// Explore the range *is* the control, so raising the limit or widening the
// range replaces the app page's infinite scroll.
func (d *Datasource) queryTraceList(ctx context.Context, query backend.DataQuery, qm queryModel, dsUID string) backend.DataResponse {
	limit := qm.Limit
	if limit <= 0 {
		limit = defaultTraceListLimit
	}

	body, err := d.client.QueryTraceList(ctx, TraceListParams{
		Where:        qm.Where,
		PostFilter:   qm.PostFilter,
		MatchCond:    qm.MatchCond,
		CustomFields: qm.CustomFields,
		Start:        query.TimeRange.From.Format(time.RFC3339Nano),
		End:          query.TimeRange.To.Format(time.RFC3339Nano),
		Limit:        limit,
	})
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("listing traces: %v", err))
	}
	defer closeBody(body)

	rows, err := parseTraceListRows(body, qm.CustomFields)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("parsing trace list: %v", err))
	}

	// The charts frame comes first: Explore stacks custom panels in the order
	// their frames arrive, so the charts sit above the list they describe.
	frames := data.Frames{
		TraceChartsFrame(dsUID),
		TraceListRowsToFrame(rows, qm.CustomFields, dsUID),
	}
	for _, frame := range frames {
		withQueryContext(frame, query.JSON)
	}
	return backend.DataResponse{Frames: frames}
}

func (d *Datasource) querySearch(ctx context.Context, query backend.DataQuery, qm queryModel) backend.DataResponse {
	limit := qm.Limit
	if limit <= 0 {
		limit = 20
	}

	resp, err := d.client.SearchTraces(ctx, SearchParams{
		Service:     qm.ServiceName,
		Operation:   qm.OperationName,
		Tags:        qm.Tags,
		Start:       query.TimeRange.From,
		End:         query.TimeRange.To,
		Limit:       limit,
		MinDuration: qm.MinDuration,
		MaxDuration: qm.MaxDuration,
	})
	if err != nil {
		if r, ok := cancelledResponse(ctx, err); ok {
			return r
		}
		return backend.ErrDataResponse(backend.StatusInternal, fmt.Sprintf("searching traces: %v", err))
	}

	frame := TraceSearchResultToFrame(resp.Data)
	return backend.DataResponse{Frames: data.Frames{frame}}
}
