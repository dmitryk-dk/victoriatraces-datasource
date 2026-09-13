package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func readErrBody(body io.Reader) []byte {
	b, err := io.ReadAll(body)
	if err != nil {
		backend.Logger.Warn("reading upstream error body", "error", err)
	}
	return b
}

func closeBody(body io.Closer) {
	if err := body.Close(); err != nil {
		backend.Logger.Debug("closing response body", "error", err)
	}
}

// attrPrefixRe matches VictoriaTraces typed-attribute prefixes such as
// "span_attr:", "resource_attr:", "scope_attr:". It is used to identify
// fields that represent typed attributes (i.e. tags searchable via the
// Jaeger API) versus raw storage fields like "_msg" or "trace_id".
var attrPrefixRe = regexp.MustCompile(`^[a-z_]+_attr:`)

// spanAttrPrefix is the only typed-attribute prefix that the Jaeger tag
// search maps to span tags. Keys with this prefix must have it stripped
// before being sent in the `tags` query argument. Other prefixes
// (resource_attr:, scope_attr:) are passed through verbatim because the
// Jaeger search matches them as-is against process/scope attributes.
const spanAttrPrefix = "span_attr:"

// Client is a thin HTTP wrapper around the VictoriaTraces Jaeger-compatible API.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a Client targeting the given base URL using the provided
// HTTP client. When httpClient is nil a 30s-timeout default is used — that
// path is intended for tests; production callers should pass a client built
// by the Grafana SDK so BasicAuth, Bearer, TLS, proxy, and timeout settings
// from the ConfigEditor are honored.
func NewClient(baseURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		baseURL:    baseURL,
		httpClient: httpClient,
	}
}

// Ping calls the upstream /health endpoint. VictoriaTraces returns a small
// 200 OK body when the process is up — this is the cheapest liveness probe
// available, so we use it as the first signal in CheckHealth.
func (c *Client) Ping(ctx context.Context) error {
	reqURL := c.baseURL + "/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing request: %w", err)
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return parseAPIError(resp.StatusCode, readErrBody(resp.Body))
	}
	return nil
}

// GetServices returns the list of service names known to VictoriaTraces.
func (c *Client) GetServices(ctx context.Context) (*JaegerServicesResponse, error) {
	var result JaegerServicesResponse
	if err := c.get(ctx, "/select/jaeger/api/services", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetOperations returns the operation names for the given service.
// VictoriaTraces uses /select/jaeger/api/services/{service}/operations (path-based, not query param).
func (c *Client) GetOperations(ctx context.Context, service string) (*JaegerOperationsResponse, error) {
	path := "/select/jaeger/api/services/" + url.PathEscape(service) + "/operations"
	var result JaegerOperationsResponse
	if err := c.get(ctx, path, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// SearchParams holds the filters for a trace search query.
type SearchParams struct {
	Service   string
	Operation string
	// Tags is a space-separated list of key=value pairs (e.g. "http.status_code=200 error=true").
	// It is converted to the JSON format that VictoriaTraces expects before sending.
	Tags  string
	Start time.Time // Inclusive lower bound of the time range
	End   time.Time // Inclusive upper bound of the time range
	Limit int       // Maximum number of traces to return
	// Duration bounds as the Jaeger API spells them, e.g. "100ms", "2s".
	MinDuration string
	MaxDuration string
}

// SearchTraces queries VictoriaTraces for traces matching the given parameters.
func (c *Client) SearchTraces(ctx context.Context, p SearchParams) (*JaegerResponse, error) {
	params := url.Values{}
	if p.Service != "" {
		params.Set("service", p.Service)
	}
	if p.Operation != "" {
		params.Set("operation", p.Operation)
	}
	if p.Tags != "" {
		// VictoriaTraces expects tags as a JSON object, e.g. {"error":"true"}.
		if jsonTags := tagsToJSON(p.Tags); jsonTags != "" {
			params.Set("tags", jsonTags)
		}
	}
	if !p.Start.IsZero() {
		params.Set("start", strconv.FormatInt(p.Start.UnixMicro(), 10))
	}
	if !p.End.IsZero() {
		params.Set("end", strconv.FormatInt(p.End.UnixMicro(), 10))
	}
	if p.MinDuration != "" {
		params.Set("minDuration", p.MinDuration)
	}
	if p.MaxDuration != "" {
		params.Set("maxDuration", p.MaxDuration)
	}
	if p.Limit > 0 {
		params.Set("limit", strconv.Itoa(p.Limit))
	}

	var result JaegerResponse
	if err := c.get(ctx, "/select/jaeger/api/traces", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// TempoSearchParams holds the filters for a Tempo-API trace search.
//
// Paging is cursor-based rather than offset-based: End moves backwards through
// time as pages are consumed, so a page boundary can never duplicate or skip a
// trace the way a shifting offset can. The caller derives the next cursor from
// the oldest trace it received.
type TempoSearchParams struct {
	// Query is a TraceQL/LogsQL filter. Empty is replaced by matchAllTracesQuery.
	Query string
	Start time.Time
	End   time.Time
	Limit int
}

// matchAllTracesQuery is the match-everything filter accepted by the Tempo
// search endpoint. It rejects both an empty query ("missing query") and the
// LogsQL wildcard "*" ("compound token cannot start with *").
const matchAllTracesQuery = "{}"

// SearchTracesTempo queries /select/tempo/api/search and returns trace summaries.
// This is the endpoint behind the trace list; the Jaeger search endpoint returns
// whole traces with all their spans, which is far more data than a list needs.
func (c *Client) SearchTracesTempo(ctx context.Context, p TempoSearchParams) (*TempoSearchResponse, error) {
	params := url.Values{}
	query := p.Query
	if query == "" {
		query = matchAllTracesQuery
	}
	params.Set("q", query)
	if !p.Start.IsZero() {
		params.Set("start", strconv.FormatInt(p.Start.Unix(), 10))
	}
	if !p.End.IsZero() {
		params.Set("end", strconv.FormatInt(p.End.Unix(), 10))
	}
	if p.Limit > 0 {
		params.Set("limit", strconv.Itoa(p.Limit))
	}

	var result TempoSearchResponse
	if err := c.get(ctx, "/select/tempo/api/search", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// QueryTraceList runs the trace-list aggregation against /select/logsql/query
// and returns the raw NDJSON body. The caller must close the returned
// ReadCloser.
//
// start and end are passed through verbatim rather than as time.Time: the
// paging cursor is the RFC3339 timestamp of the last row seen, and round-
// tripping it through a coarser unit would risk re-serving or skipping rows.
func (c *Client) QueryTraceList(ctx context.Context, p TraceListParams) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildTraceListQuery(p.Where, p.PostFilter, p.MatchCond, p.CustomFields, p.Limit))
	if p.Start != "" {
		params.Set("start", p.Start)
	}
	if p.End != "" {
		params.Set("end", p.End)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryLogsQLStream runs a prepared LogsQL query and returns the raw NDJSON
// body. The caller must close the returned ReadCloser.
func (c *Client) QueryLogsQLStream(ctx context.Context, query, start, end string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", query)
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryOperationDurations returns the raw NDJSON duration sample behind the
// preview panel's histogram. The caller must close the returned ReadCloser.
func (c *Client) QueryOperationDurations(ctx context.Context, service, operation string, rootOnly bool, start, end string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildOperationDurationsQuery(service, operation, rootOnly))
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryHeatmap runs the duration/time grid aggregation and returns the raw
// NDJSON body. The caller must close the returned ReadCloser.
func (c *Client) QueryHeatmap(ctx context.Context, where string, stepSeconds int64, start, end string, entity entityKind) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildHeatmapQuery(where, stepSeconds, entity))
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryFacet counts distinct traces per value of one field and returns the raw
// NDJSON body. The caller must close the returned ReadCloser.
func (c *Client) QueryFacet(ctx context.Context, where, field string, limit int, start, end string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildFacetQuery(where, field, limit))
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QuerySpanList selects individual spans and returns the raw NDJSON body. The
// caller must close the returned ReadCloser.
func (c *Client) QuerySpanList(ctx context.Context, where string, limit int, start, end string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildSpanListQuery(where, limit))
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryOperationStats aggregates a service's spans by operation name and
// returns the raw NDJSON body. The caller must close the returned ReadCloser.
func (c *Client) QueryOperationStats(ctx context.Context, service, start, end string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", buildOperationStatsQuery(service))
	if start != "" {
		params.Set("start", start)
	}
	if end != "" {
		params.Set("end", end)
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// GetDependencies returns the service dependency graph. endTs and lookback are
// both in milliseconds, matching the Jaeger API.
func (c *Client) GetDependencies(ctx context.Context, endTs, lookback int64) (*JaegerDependenciesResponse, error) {
	params := url.Values{}
	if endTs > 0 {
		params.Set("endTs", strconv.FormatInt(endTs, 10))
	}
	if lookback > 0 {
		params.Set("lookback", strconv.FormatInt(lookback, 10))
	}

	var result JaegerDependenciesResponse
	if err := c.get(ctx, "/select/jaeger/api/dependencies", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// QueryLogsQLRange sends a LogsQL expression to the stats_query_range endpoint
// and returns a Prometheus-style matrix response suitable for time-series panels.
// offset is an optional timezone offset for bucket alignment (e.g. "+02:00"), pass "" to omit.
func (c *Client) QueryLogsQLRange(ctx context.Context, expr string, start, end time.Time, step, offset string) (*LogsQLResponse, error) {
	params := baseRangeParams(expr, start, end, offset)
	if step != "" {
		params.Set("step", step)
	}
	var result LogsQLResponse
	if err := c.get(ctx, "/select/logsql/stats_query_range", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// QueryLogsQLInstant sends a LogsQL expression to the stats_query endpoint
// and returns a Prometheus-style vector response for stat/single-value panels.
// t is the evaluation timestamp (typically the end of the selected time range).
func (c *Client) QueryLogsQLInstant(ctx context.Context, expr string, t time.Time, offset string) (*LogsQLResponse, error) {
	params := url.Values{}
	params.Set("query", expr)
	params.Set("time", strconv.FormatInt(t.Unix(), 10))
	if offset != "" {
		params.Set("offset", offset)
	}

	var result LogsQLResponse
	if err := c.get(ctx, "/select/logsql/stats_query", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// getStream executes a GET request and returns the response body for streaming
// consumption. The caller must Close the returned ReadCloser on success.
func (c *Client) getStream(ctx context.Context, path string, params url.Values) (io.ReadCloser, error) {
	reqURL := c.baseURL + path
	if len(params) > 0 {
		reqURL += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		body := readErrBody(resp.Body)
		closeBody(resp.Body)
		return nil, parseAPIError(resp.StatusCode, body)
	}
	return resp.Body, nil
}

// baseRangeParams builds the (query, start, end, offset) params shared by every
// LogsQL range/logs/hits call.
func baseRangeParams(expr string, start, end time.Time, offset string) url.Values {
	params := url.Values{}
	params.Set("query", expr)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(end.Unix(), 10))
	if offset != "" {
		params.Set("offset", offset)
	}
	return params
}

// QueryLogsQLLogs queries /select/logsql/query and returns the raw NDJSON body.
// The caller must close the returned ReadCloser.
func (c *Client) QueryLogsQLLogs(ctx context.Context, expr string, start, end time.Time, limit int, offset string) (io.ReadCloser, error) {
	params := baseRangeParams(expr, start, end, offset)
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	return c.getStream(ctx, "/select/logsql/query", params)
}

// QueryLogsQLTail opens a live-tail stream against /select/logsql/tail.
// The endpoint streams NDJSON lines without a fixed end, so the caller must
// use a timeout-less HTTP client and close the returned ReadCloser when done.
func (c *Client) QueryLogsQLTail(ctx context.Context, expr string) (io.ReadCloser, error) {
	params := url.Values{}
	params.Set("query", expr)
	return c.getStream(ctx, "/select/logsql/tail", params)
}

// QueryLogsQLHits queries /select/logsql/hits and returns the raw JSON body.
// The caller must close the returned ReadCloser.
func (c *Client) QueryLogsQLHits(ctx context.Context, expr string, start, end time.Time, step, offset string, fields []string) (io.ReadCloser, error) {
	params := baseRangeParams(expr, start, end, offset)
	if step != "" {
		params.Set("step", step)
	}
	for _, f := range fields {
		params.Add("field", f)
	}
	return c.getStream(ctx, "/select/logsql/hits", params)
}

// serviceFilterLogsQL builds an exact-match LogsQL filter scoped to a service name.
// %q quotes + escapes the value so names with spaces, dots, dashes, or quotes work.
func serviceFilterLogsQL(service string) string {
	return fmt.Sprintf(`"resource_attr:service.name":=%q`, service)
}

// pickMetaQuery returns the LogsQL filter to use for field_names / field_values
// metadata calls. An explicit rawQuery wins; otherwise scope by service name;
// fall back to "*" (match everything) so the endpoint accepts the request.
func pickMetaQuery(service, rawQuery string) string {
	switch {
	case rawQuery != "":
		return rawQuery
	case service != "":
		return serviceFilterLogsQL(service)
	default:
		return "*"
	}
}

// setMetaRange scopes a metadata lookup to the range on screen. Without it the
// suggestions come from the whole retention window, so they can name keys that
// no longer occur in the range being looked at and miss ones that do.
func setMetaRange(params url.Values, start, end time.Time) {
	if !start.IsZero() {
		params.Set("start", strconv.FormatInt(start.Unix(), 10))
	}
	if !end.IsZero() {
		params.Set("end", strconv.FormatInt(end.Unix(), 10))
	}
}

// GetFieldNames returns field names, optionally scoped by a raw LogsQL filter or a service name.
func (c *Client) GetFieldNames(ctx context.Context, service, rawQuery string, start, end time.Time) (*FieldNamesResponse, error) {
	params := url.Values{}
	params.Set("query", pickMetaQuery(service, rawQuery))
	setMetaRange(params, start, end)
	var result FieldNamesResponse
	if err := c.get(ctx, "/select/logsql/field_names", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetFieldValues returns values for a specific field, optionally scoped by a raw LogsQL filter or a service name.
func (c *Client) GetFieldValues(ctx context.Context, field string, limit int, service, rawQuery string, start, end time.Time) (*FieldValuesResponse, error) {
	params := url.Values{}
	params.Set("query", pickMetaQuery(service, rawQuery))
	setMetaRange(params, start, end)
	params.Set("field", field)
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	var result FieldValuesResponse
	if err := c.get(ctx, "/select/logsql/field_values", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetTrace retrieves a single trace by its ID.
//
// The time range is required: without it VictoriaTraces rejects the request as
// "out of retention" rather than searching all retained data, so a trace that
// exists is reported as missing.
func (c *Client) GetTrace(ctx context.Context, traceID string, start, end time.Time) (*JaegerResponse, error) {
	params := url.Values{}
	if !start.IsZero() {
		params.Set("start", strconv.FormatInt(start.UnixMicro(), 10))
	}
	if !end.IsZero() {
		params.Set("end", strconv.FormatInt(end.UnixMicro(), 10))
	}

	var result JaegerResponse
	if err := c.get(ctx, "/select/jaeger/api/traces/"+traceID, params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// tagsToJSON converts a space-separated "key=value" tag string into the JSON
// object expected by the Jaeger search API. The "span_attr:" prefix is stripped
// because Jaeger matches span tags by their bare name; other prefixes
// (resource_attr:, scope_attr:, ...) are preserved because Jaeger matches them
// verbatim against process/scope attributes.
func tagsToJSON(tags string) string {
	m := make(map[string]string)
	for _, pair := range strings.Fields(tags) {
		k, v, ok := strings.Cut(pair, "=")
		if ok && k != "" {
			m[strings.TrimPrefix(k, spanAttrPrefix)] = v
		}
	}
	if len(m) == 0 {
		return ""
	}
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	return string(b)
}

// APIError wraps a non-2xx response from VictoriaTraces. The underlying body is
// typically Jaeger-shaped JSON with an `errors` array; if so we extract the
// first message and present it cleanly. Status is preserved so callers can
// distinguish 404 (trace not found) from 5xx (transport / backend problems).
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("status %d: %s", e.Status, e.Message)
}

// IsNotFound reports whether err is an APIError carrying a 404 status.
func IsNotFound(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status == http.StatusNotFound
	}
	return false
}

// jaegerErrorBody is just enough of the response shape to pluck a human
// message out of VictoriaTraces' Jaeger-style error payload.
type jaegerErrorBody struct {
	Errors []struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	} `json:"errors"`
}

// parseAPIError builds an APIError from a non-2xx response body. If the body
// is JSON with a Jaeger-style errors array we use that message; otherwise we
// fall back to the raw body so debugging info isn't lost.
func parseAPIError(status int, body []byte) *APIError {
	var je jaegerErrorBody
	if err := json.Unmarshal(body, &je); err == nil && len(je.Errors) > 0 {
		return &APIError{Status: status, Message: je.Errors[0].Msg}
	}
	msg := strings.TrimSpace(string(body))
	if msg == "" {
		msg = http.StatusText(status)
	}
	return &APIError{Status: status, Message: msg}
}

func (c *Client) get(ctx context.Context, path string, params url.Values, out interface{}) error {
	reqURL := c.baseURL + path
	if len(params) > 0 {
		reqURL += "?" + params.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing request: %w", err)
	}
	defer closeBody(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return parseAPIError(resp.StatusCode, readErrBody(resp.Body))
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
}
