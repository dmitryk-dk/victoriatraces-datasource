package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
)

// victoriaTracesClient is the interface the Datasource uses to talk to
// VictoriaTraces. The concrete *Client satisfies it; tests use a mock.
type victoriaTracesClient interface {
	Ping(ctx context.Context) error
	GetServices(ctx context.Context) (*JaegerServicesResponse, error)
	GetOperations(ctx context.Context, service string) (*JaegerOperationsResponse, error)
	SearchTraces(ctx context.Context, p SearchParams) (*JaegerResponse, error)
	GetTrace(ctx context.Context, traceID string) (*JaegerResponse, error)
	GetFieldNames(ctx context.Context, service, rawQuery string) (*FieldNamesResponse, error)
	GetFieldValues(ctx context.Context, field string, limit int, service, rawQuery string) (*FieldValuesResponse, error)
	QueryLogsQLRange(ctx context.Context, expr string, start, end time.Time, step, offset string) (*LogsQLResponse, error)
	QueryLogsQLInstant(ctx context.Context, expr string, t time.Time, offset string) (*LogsQLResponse, error)
	QueryLogsQLLogs(ctx context.Context, expr string, start, end time.Time, limit int, offset string) (io.ReadCloser, error)
	QueryLogsQLHits(ctx context.Context, expr string, start, end time.Time, step, offset string, fields []string) (io.ReadCloser, error)
}

// Datasource implements the Grafana backend datasource interfaces.
type Datasource struct {
	client     victoriaTracesClient
	httpClient *http.Client
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

	return &Datasource{
		client:     NewClient(baseURL, httpClient),
		httpClient: httpClient,
	}, nil
}

// Dispose closes idle connections so the underlying transport doesn't leak
// when the instance is replaced (e.g. after a settings change).
func (d *Datasource) Dispose() {
	if d.httpClient != nil {
		d.httpClient.CloseIdleConnections()
	}
}

// QueryData handles all data queries from Grafana panels and Explore.
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	resp := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		resp.Responses[q.RefID] = d.handleQuery(ctx, q)
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
	if _, err := d.client.GetFieldNames(ctx, "", ""); err != nil {
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
		return d.resourceFieldNames(ctx, qs.Get("service"), qs.Get("query"), sender)
	case "field_values":
		limit := 0
		if v := qs.Get("limit"); v != "" {
			// Non-numeric limits collapse to 0; resourceFieldValues then
			// re-defaults to 100, so the parse error doesn't need to surface.
			limit, _ = strconv.Atoi(v)
		}
		return d.resourceFieldValues(ctx, qs.Get("field"), limit, qs.Get("service"), qs.Get("query"), sender)
	default:
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

func (d *Datasource) resourceFieldNames(ctx context.Context, service, rawQuery string, sender backend.CallResourceResponseSender) error {
	resp, err := d.client.GetFieldNames(ctx, service, rawQuery)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	// Only expose typed-attribute fields (span_attr:, resource_attr:, ...) —
	// those are the ones the Jaeger tag search can match against.
	names := make([]string, 0, len(resp.Values))
	for _, v := range resp.Values {
		if attrPrefixRe.MatchString(v.Value) {
			names = append(names, v.Value)
		}
	}
	return sendJSON(sender, http.StatusOK, names)
}

func (d *Datasource) resourceFieldValues(ctx context.Context, field string, limit int, service, rawQuery string, sender backend.CallResourceResponseSender) error {
	if field == "" {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "missing 'field' parameter"})
	}
	if limit <= 0 {
		limit = 100
	}
	resp, err := d.client.GetFieldValues(ctx, field, limit, service, rawQuery)
	if err != nil {
		return sendJSON(sender, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	values := make([]string, 0, len(resp.Values))
	for _, v := range resp.Values {
		values = append(values, v.Value)
	}
	return sendJSON(sender, http.StatusOK, values)
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
