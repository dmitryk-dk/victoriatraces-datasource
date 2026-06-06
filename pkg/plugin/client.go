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
)

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
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return parseAPIError(resp.StatusCode, body)
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
	if p.Limit > 0 {
		params.Set("limit", strconv.Itoa(p.Limit))
	}

	var result JaegerResponse
	if err := c.get(ctx, "/select/jaeger/api/traces", params, &result); err != nil {
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
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
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

// GetFieldNames returns field names, optionally scoped by a raw LogsQL filter or a service name.
func (c *Client) GetFieldNames(ctx context.Context, service, rawQuery string) (*FieldNamesResponse, error) {
	params := url.Values{}
	params.Set("query", pickMetaQuery(service, rawQuery))
	var result FieldNamesResponse
	if err := c.get(ctx, "/select/logsql/field_names", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetFieldValues returns values for a specific field, optionally scoped by a raw LogsQL filter or a service name.
func (c *Client) GetFieldValues(ctx context.Context, field string, limit int, service, rawQuery string) (*FieldValuesResponse, error) {
	params := url.Values{}
	params.Set("query", pickMetaQuery(service, rawQuery))
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
func (c *Client) GetTrace(ctx context.Context, traceID string) (*JaegerResponse, error) {
	var result JaegerResponse
	if err := c.get(ctx, "/select/jaeger/api/traces/"+traceID, nil, &result); err != nil {
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
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return parseAPIError(resp.StatusCode, body)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	return nil
}
