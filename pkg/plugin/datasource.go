package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// victoriaTracesClient is the interface the Datasource uses to talk to
// VictoriaTraces. The concrete *Client satisfies it; tests use a mock.
type victoriaTracesClient interface {
	Ping(ctx context.Context) error
	GetServices(ctx context.Context) (*JaegerServicesResponse, error)
	GetOperations(ctx context.Context, service string) (*JaegerOperationsResponse, error)
	SearchTraces(ctx context.Context, p SearchParams) (*JaegerResponse, error)
	SearchTracesTempo(ctx context.Context, p TempoSearchParams) (*TempoSearchResponse, error)
	QueryTraceList(ctx context.Context, p TraceListParams) (io.ReadCloser, error)
	QueryLogsQLStream(ctx context.Context, query, start, end string) (io.ReadCloser, error)
	QueryOperationDurations(ctx context.Context, service, operation string, rootOnly bool, start, end string) (io.ReadCloser, error)
	QueryHeatmap(ctx context.Context, where string, stepSeconds int64, start, end string) (io.ReadCloser, error)
	QueryOperationStats(ctx context.Context, service, start, end string) (io.ReadCloser, error)
	QuerySpanList(ctx context.Context, where string, limit int, start, end string) (io.ReadCloser, error)
	QueryFacet(ctx context.Context, where, field string, limit int, start, end string) (io.ReadCloser, error)
	GetTrace(ctx context.Context, traceID string, start, end time.Time) (*JaegerResponse, error)
	GetDependencies(ctx context.Context, endTs, lookback int64) (*JaegerDependenciesResponse, error)
	GetFieldNames(ctx context.Context, service, rawQuery string, start, end time.Time) (*FieldNamesResponse, error)
	GetFieldValues(ctx context.Context, field string, limit int, service, rawQuery string, start, end time.Time) (*FieldValuesResponse, error)
	QueryLogsQLRange(ctx context.Context, expr string, start, end time.Time, step, offset string) (*LogsQLResponse, error)
	QueryLogsQLInstant(ctx context.Context, expr string, t time.Time, offset string) (*LogsQLResponse, error)
	QueryLogsQLLogs(ctx context.Context, expr string, start, end time.Time, limit int, offset string) (io.ReadCloser, error)
	QueryLogsQLHits(ctx context.Context, expr string, start, end time.Time, step, offset string, fields []string) (io.ReadCloser, error)
	QueryLogsQLTail(ctx context.Context, expr string) (io.ReadCloser, error)
}

// Ensure Datasource implements the backend.StreamHandler interface so the SDK
// wires up Subscribe/Publish/Run calls when the frontend opens a Live channel.
var (
	_ backend.QueryDataHandler    = (*Datasource)(nil)
	_ backend.CheckHealthHandler  = (*Datasource)(nil)
	_ backend.CallResourceHandler = (*Datasource)(nil)
	_ backend.StreamHandler       = (*Datasource)(nil)
)

// Datasource implements the Grafana backend datasource interfaces.
type Datasource struct {
	client     victoriaTracesClient
	httpClient *http.Client

	// streamClient is a timeout-less HTTP client used only for live-tail
	// requests against /select/logsql/tail. The endpoint streams forever, so
	// the regular httpClient's response timeout would cut the connection.
	streamClient *http.Client
	// tailClient wraps streamClient with the same base URL as the main client
	// and exposes only QueryLogsQLTail.
	tailClient victoriaTracesClient

	// liveChannels isolates frame streams per Live channel path
	// (`${requestId}/${refId}`). Two browser tabs use different requestIds
	// so each gets its own upstream tail connection — without this map
	// they would race over a shared sender. Dispose closes any in-flight
	// channels here so blocked goroutines can exit on instance replacement.
	liveChannels sync.Map
}

// datasourceSettings mirrors the JSON stored in the datasource configuration.
// Only fields the backend reads are listed; everything else (auth, TLS, proxy
// options) is plumbed through httpclient.Options from settings.
type datasourceSettings struct {
	URL string `json:"url"`
}

// NewDatasource is the instance factory called by datasource.Manage on each
// datasource configuration save or Grafana restart.
//
// It builds the upstream HTTP client via the Grafana SDK so all auth methods
// configured in the ConfigEditor (Basic, Bearer, custom headers, TLS client
// cert + CA, mTLS, timeout, proxy) are applied without any per-method wiring
// in this file. SecureJsonData secrets are decrypted by the SDK and added to
// the right request stage automatically.
func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	var ds datasourceSettings
	if err := json.Unmarshal(settings.JSONData, &ds); err != nil {
		return nil, fmt.Errorf("parsing datasource settings: %w", err)
	}

	// Fall back to the top-level URL if the JSON field is empty.
	baseURL := ds.URL
	if baseURL == "" {
		baseURL = settings.URL
	}

	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("preparing http client options: %w", err)
	}
	httpClient, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("creating http client: %w", err)
	}

	// Live tail responses stream indefinitely. Build a second client with
	// the same auth/TLS/proxy plumbing but no response timeout, otherwise
	// the regular client would terminate the connection. Copy the existing
	// timeout struct so dial/keepalive/handshake budgets are preserved.
	streamOpts := opts
	to := httpclient.DefaultTimeoutOptions
	if opts.Timeouts != nil {
		to = *opts.Timeouts
	}
	to.Timeout = 0
	streamOpts.Timeouts = &to
	streamClient, err := httpclient.New(streamOpts)
	if err != nil {
		return nil, fmt.Errorf("creating stream http client: %w", err)
	}

	return &Datasource{
		client:       NewClient(baseURL, httpClient),
		httpClient:   httpClient,
		streamClient: streamClient,
		tailClient:   NewClient(baseURL, streamClient),
	}, nil
}

// Dispose closes idle connections so the underlying transport doesn't leak
// when the instance is replaced (e.g. after a settings change). Live-tail
// channels are owned by their RunStream goroutine: Grafana cancels its
// context when subscribers go away, the parser exits, and RunStream's defer
// closes the channel. Dispose never touches the channels — that would race
// with the owning goroutine and could panic on close-of-closed.
func (d *Datasource) Dispose() {
	if d.httpClient != nil {
		d.httpClient.CloseIdleConnections()
	}
	if d.streamClient != nil {
		d.streamClient.CloseIdleConnections()
	}
}

// QueryData handles all data queries from Grafana panels and Explore.
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	// The panel needs the datasource uid to call resource endpoints of its own
	// (facets, heatmap, trace detail). Explore does not reliably carry it on the
	// request the panel receives, so it travels on the frame instead.
	var dsUID string
	if req.PluginContext.DataSourceInstanceSettings != nil {
		dsUID = req.PluginContext.DataSourceInstanceSettings.UID
	}

	resp := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		resp.Responses[q.RefID] = d.handleQuery(ctx, q, dsUID)
	}
	return resp, nil
}

// CheckHealth verifies VictoriaTraces is alive and answering queries.
// /health confirms the process is up and routing requests.
// A trivial LogsQL field_names probe with query="*" confirms the query
// pipeline (auth, parser, storage access) is wired up correctly.
// /health failure is fatal — the upstream is down. A /health success with a
// failing LogsQL probe surfaces config or auth issues that a simple ping
// would miss.
func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if err := d.client.Ping(ctx); err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("cannot reach VictoriaTraces /health: %v", err),
		}, nil
	}
	if _, err := d.client.GetFieldNames(ctx, "", "", time.Time{}, time.Time{}); err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("VictoriaTraces is reachable but query failed: %v", err),
		}, nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Connected to VictoriaTraces — /health OK, query OK",
	}, nil
}

// parseResourceQuery extracts the query string portion from a CallResourceRequest URL.
// req.URL has the form "<path>?<query>" — anything before the ? is ignored.
func parseResourceQuery(reqURL string) url.Values {
	idx := strings.Index(reqURL, "?")
	if idx < 0 {
		return url.Values{}
	}
	// url.ParseQuery only fails on malformed escape sequences and still
	// returns any pairs it could decode before the error. Partial values
	// are fine here — callers Get() each key individually and treat empty
	// strings as "not provided".
	qs, _ := url.ParseQuery(reqURL[idx+1:])
	return qs
}

// CallResource handles resource requests from the frontend (service/operation
// discovery used to populate query editor dropdowns).
func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	qs := parseResourceQuery(req.URL)
	switch req.Path {
	case "services":
		return d.resourceServices(ctx, sender)
	case "operations":
		return d.resourceOperations(ctx, qs.Get("service"), sender)
	case "field_names":
		return d.resourceFieldNames(ctx, qs, sender)
	case "field_values":
		limit := 0
		if v := qs.Get("limit"); v != "" {
			// Non-numeric limits collapse to 0; resourceFieldValues then
			// re-defaults to 100, so the parse error doesn't need to surface.
			limit, _ = strconv.Atoi(v)
		}
		return d.resourceFieldValues(ctx, qs, limit, sender)
	case "search":
		return d.resourceSearch(ctx, qs, sender)
	case "trace_list":
		return d.resourceTraceList(ctx, qs, sender)
	case "trace_sample":
		return d.resourceTraceSample(ctx, qs, sender)
	case "operation_durations":
		return d.resourceOperationDurations(ctx, qs, sender)
	case "heatmap":
		return d.resourceHeatmap(ctx, qs, sender)
	case "operation_stats":
		return d.resourceOperationStats(ctx, qs, sender)
	case "facets":
		return d.resourceFacets(ctx, qs, sender)
	case "dependencies":
		return d.resourceDependencies(ctx, qs, sender)
	default:
		// Trace lookup is the only path with a variable segment: "trace/<id>".
		if id, ok := strings.CutPrefix(req.Path, "trace/"); ok {
			return d.resourceTrace(ctx, id, qs, sender)
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound})
	}
}

func (d *Datasource) resourceServices(ctx context.Context, sender backend.CallResourceResponseSender) error {
	resp, err := d.client.GetServices(ctx)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, resp.Data)
}

func (d *Datasource) resourceOperations(ctx context.Context, service string, sender backend.CallResourceResponseSender) error {
	resp, err := d.client.GetOperations(ctx, service)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, resp.Data)
}

func (d *Datasource) resourceFieldNames(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	resp, err := d.client.GetFieldNames(
		ctx,
		qs.Get("service"),
		qs.Get("query"),
		parseRFC3339(qs.Get("start")),
		parseRFC3339(qs.Get("end")),
	)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	// Only expose typed-attribute fields (span_attr:, resource_attr:, ...) —
	// those are the ones the Jaeger tag search can match against. Hit counts
	// travel with them so the picker can offer the common keys first.
	names := make([]ValueWithHits, 0, len(resp.Values))
	for _, v := range resp.Values {
		if attrPrefixRe.MatchString(v.Value) {
			names = append(names, v)
		}
	}
	return sendJSON(sender, http.StatusOK, names)
}

func (d *Datasource) resourceFieldValues(ctx context.Context, qs url.Values, limit int, sender backend.CallResourceResponseSender) error {
	field := qs.Get("field")
	if field == "" {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing 'field' parameter"})
	}
	if limit <= 0 {
		limit = 100
	}
	resp, err := d.client.GetFieldValues(
		ctx,
		field,
		limit,
		qs.Get("service"),
		qs.Get("query"),
		parseRFC3339(qs.Get("start")),
		parseRFC3339(qs.Get("end")),
	)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	values := make([]string, 0, len(resp.Values))
	for _, v := range resp.Values {
		values = append(values, v.Value)
	}
	return sendJSON(sender, http.StatusOK, values)
}

// parseRFC3339 reads an RFC3339 query argument, yielding the zero time when it
// is missing or malformed so the caller can omit it.
func parseRFC3339(v string) time.Time {
	if v == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return time.Time{}
	}
	return t
}

// parseUnixSeconds reads a Unix-seconds query argument. Missing or malformed
// values yield the zero time, which the client then omits from the request.
func parseUnixSeconds(v string) time.Time {
	if v == "" {
		return time.Time{}
	}
	secs, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.Unix(secs, 0)
}

// resourceSearch backs the trace list on the app page. Start and end are Unix
// seconds; end doubles as the paging cursor.
func (d *Datasource) resourceSearch(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	limit := 0
	if v := qs.Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	if limit <= 0 {
		limit = 50
	}

	resp, err := d.client.SearchTracesTempo(ctx, TempoSearchParams{
		Query: qs.Get("q"),
		Start: parseUnixSeconds(qs.Get("start")),
		End:   parseUnixSeconds(qs.Get("end")),
		Limit: limit,
	})
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	traces := resp.Traces
	if traces == nil {
		traces = []TempoTraceSummary{}
	}
	return sendJSON(sender, http.StatusOK, traces)
}

// TraceSampleResponse is the scatter plot's sample plus the size of the set it
// was drawn from, so the chart can say how much of the range it shows.
type TraceSampleResponse struct {
	Rows  []TraceListRow `json:"rows"`
	Total int64          `json:"total"`
}

// resourceTraceSample backs the scatter plot: a spread sample of the traces in
// range, rather than the newest page of them.
func (d *Datasource) resourceTraceSample(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	limit := 0
	if v := qs.Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	where, start, end := qs.Get("where"), qs.Get("start"), qs.Get("end")

	body, err := d.client.QueryLogsQLStream(ctx, buildTraceSampleQuery(where, limit), start, end)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	rows, err := parseTraceListRows(body, nil)
	closeBody(body)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// A failed count still leaves a usable chart, so it is not fatal: the
	// legend simply cannot say what the sample was drawn from.
	var total int64
	if countBody, cErr := d.client.QueryLogsQLStream(ctx, buildTraceCountQuery(where), start, end); cErr == nil {
		total, _ = parseTraceCount(countBody)
		closeBody(countBody)
	}

	return sendJSON(sender, http.StatusOK, TraceSampleResponse{Rows: rows, Total: total})
}

// resourceTraceList backs the trace list on the app page. Unlike resourceSearch
// it aggregates spans per trace, so rows carry span counts, error counts and
// the trace's full service set.
func (d *Datasource) resourceTraceList(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	limit := 0
	if v := qs.Get("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}

	customFields := qs["customField"]

	body, err := d.client.QueryTraceList(ctx, TraceListParams{
		Where:        qs.Get("where"),
		PostFilter:   qs.Get("postFilter"),
		MatchCond:    qs.Get("matchCond"),
		CustomFields: customFields,
		Start:        qs.Get("start"),
		End:          qs.Get("end"),
		Limit:        limit,
	})
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer closeBody(body)

	rows, err := parseTraceListRows(body, customFields)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, rows)
}

// resourceOperationDurations returns the duration sample the preview panel's
// histogram compares a row against.
func (d *Datasource) resourceOperationDurations(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	service, operation := qs.Get("service"), qs.Get("operation")
	if service == "" || operation == "" {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing 'service' or 'operation' parameter"})
	}

	body, err := d.client.QueryOperationDurations(ctx, service, operation, qs.Get("rootOnly") == "true", qs.Get("start"), qs.Get("end"))
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer closeBody(body)

	durations, err := parseDurationsMicros(body)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, durations)
}

// resourceHeatmap backs the duration-over-time grid above the trace list.
// startMs and endMs bound the grid; the bucket width is derived from them.
func (d *Datasource) resourceHeatmap(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	startMs, errStart := strconv.ParseInt(qs.Get("startMs"), 10, 64)
	endMs, errEnd := strconv.ParseInt(qs.Get("endMs"), 10, 64)
	if errStart != nil || errEnd != nil || endMs <= startMs {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "invalid 'startMs' or 'endMs'"})
	}

	stepSeconds := heatmapStepSeconds(startMs, endMs)

	body, err := d.client.QueryHeatmap(ctx, qs.Get("where"), stepSeconds, qs.Get("start"), qs.Get("end"))
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer closeBody(body)

	data, err := parseHeatmap(body, startMs, endMs, stepSeconds*1000)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, data)
}

// resourceFacets backs the filter sidebar: the common values of each requested
// field, with the number of traces carrying them.
func (d *Datasource) resourceFacets(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	fields := qs["field"]
	if len(fields) == 0 {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing 'field' parameter"})
	}

	facets, err := d.collectFacets(ctx, qs.Get("where"), fields, qs.Get("start"), qs.Get("end"))
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return sendJSON(sender, http.StatusOK, facets)
}

// resourceOperationStats backs the operations overview: per-operation span
// counts, average duration and error counts for one service.
func (d *Datasource) resourceOperationStats(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	service := qs.Get("service")
	if service == "" {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing 'service' parameter"})
	}

	body, err := d.client.QueryOperationStats(ctx, service, qs.Get("start"), qs.Get("end"))
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer closeBody(body)

	stats, truncated, err := parseOperationStats(body)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	// Wrapped rather than a bare array: the UI has to be able to say that the
	// list it is showing is not the whole story.
	return sendJSON(sender, http.StatusOK, OperationStatsResponse{Stats: stats, Truncated: truncated})
}

// resourceTrace returns a single trace with all of its spans. The time range is
// passed through because the upstream requires one.
func (d *Datasource) resourceTrace(ctx context.Context, traceID string, qs url.Values, sender backend.CallResourceResponseSender) error {
	if traceID == "" {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing trace id"})
	}
	resp, err := d.client.GetTrace(ctx, traceID, parseRFC3339(qs.Get("start")), parseRFC3339(qs.Get("end")))
	if err != nil {
		// A 404 here means the trace expired or never arrived — a normal outcome
		// worth distinguishing from a backend failure.
		if IsNotFound(err) {
			return sendJSON(sender, http.StatusNotFound, map[string]string{"error": "trace not found"})
		}
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if len(resp.Data) == 0 {
		return sendJSON(sender, http.StatusNotFound, map[string]string{"error": "trace not found"})
	}
	return sendJSON(sender, http.StatusOK, resp.Data[0])
}

// resourceDependencies backs the service dependency graph. endTs and lookback
// are milliseconds, matching the Jaeger API.
func (d *Datasource) resourceDependencies(ctx context.Context, qs url.Values, sender backend.CallResourceResponseSender) error {
	var endTs, lookback int64
	if v := qs.Get("endTs"); v != "" {
		endTs, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := qs.Get("lookback"); v != "" {
		lookback, _ = strconv.ParseInt(v, 10, 64)
	}

	resp, err := d.client.GetDependencies(ctx, endTs, lookback)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	deps := resp.Data
	if deps == nil {
		deps = []ServiceDependency{}
	}
	return sendJSON(sender, http.StatusOK, deps)
}

// SubscribeStream authorises a Live channel subscription and pre-allocates
// the per-path frame channel so RunStream can begin sending immediately.
// Path is `${requestId}/${refId}` — each browser tab has a unique requestId
// so subscriptions never collide across tabs.
func (d *Datasource) SubscribeStream(_ context.Context, req *backend.SubscribeStreamRequest) (*backend.SubscribeStreamResponse, error) {
	ch := make(chan *data.Frame, 16)
	d.liveChannels.Store(req.Path, ch)
	return &backend.SubscribeStreamResponse{Status: backend.SubscribeStreamStatusOK}, nil
}

// PublishStream rejects all client-side publishes — the live tail is
// server-to-client only, the client never pushes data into the channel.
func (d *Datasource) PublishStream(_ context.Context, _ *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	return &backend.PublishStreamResponse{Status: backend.PublishStreamStatusPermissionDenied}, nil
}

// RunStream opens the tail connection and fans NDJSON lines into the
// per-path frame channel that SubscribeStream set up. Grafana retries this
// call ~every 5s when the upstream connection closes; the previous channel
// was closed and removed at the end of the prior attempt, so each retry
// lazily creates a fresh one — Subscribe is only called once per session.
func (d *Datasource) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {
	var qm queryModel
	if err := json.Unmarshal(req.Data, &qm); err != nil {
		return fmt.Errorf("parsing stream query: %w", err)
	}
	if qm.Expr == "" {
		return fmt.Errorf("expr is required for live tail")
	}

	v, ok := d.liveChannels.Load(req.Path)
	if !ok {
		v = make(chan *data.Frame, 16)
		d.liveChannels.Store(req.Path, v)
	}
	frames, ok := v.(chan *data.Frame)
	if !ok {
		return fmt.Errorf("unexpected channel type for path %q", req.Path)
	}
	// RunStream owns the channel: it is the only writer, and it closes
	// the channel here so the sender goroutine drains and exits. Delete
	// the map entry so the next retry lazy-creates a fresh channel
	// instead of reusing this drained one.
	defer func() {
		d.liveChannels.Delete(req.Path)
		close(frames)
	}()

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	body, err := d.tailClient.QueryLogsQLTail(streamCtx, qm.Expr)
	if err != nil {
		// Some upstream errors are permanent for this expression — e.g.
		// /tail rejects pipes with a 400. Retrying the same query will
		// never succeed, so surface the message once via a notice frame
		// and return nil so Grafana's RunStream supervisor stops retrying.
		if isPermanentTailError(err) {
			_ = sender.SendFrame(buildTailNoticeFrame(err.Error()), data.IncludeAll)
			return nil
		}
		return fmt.Errorf("opening tail stream: %w", err)
	}
	defer func() {
		if cErr := body.Close(); cErr != nil {
			backend.Logger.Debug("closing tail response body", "error", cErr)
		}
	}()

	senderErrs := make(chan error, 1)
	go func() {
		// FrameJSONCache lets us reuse the schema across frames with the
		// same structure, dropping bytes on the wire — matches what the
		// VictoriaLogs datasource does in RunStream.
		var prev data.FrameJSONCache
		for frame := range frames {
			next, err := data.FrameToJSONCache(frame)
			if err != nil {
				senderErrs <- fmt.Errorf("caching frame JSON: %w", err)
				cancel()
				return
			}
			var sErr error
			if next.SameSchema(&prev) {
				sErr = sender.SendBytes(next.Bytes(data.IncludeAll))
			} else {
				sErr = sender.SendFrame(frame, data.IncludeAll)
			}
			prev = next
			if sErr != nil {
				if errors.Is(sErr, context.Canceled) {
					return
				}
				senderErrs <- sErr
				cancel()
				return
			}
		}
	}()

	parseErr := parseTailStream(streamCtx, body, frames)
	select {
	case sErr := <-senderErrs:
		return sErr
	default:
	}
	return parseErr
}

func sendJSON(sender backend.CallResourceResponseSender, status int, body interface{}) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return sender.Send(&backend.CallResourceResponse{
		Status:  status,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    b,
	})
}
