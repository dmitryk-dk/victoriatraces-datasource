package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockClient is a test double for victoriaTracesClient.
type mockClient struct {
	services             *JaegerServicesResponse
	operations           *JaegerOperationsResponse
	traces               *JaegerResponse
	tempoTraces          *TempoSearchResponse
	traceListNDJSON      string
	durationsNDJSON      string
	heatmapNDJSON        string
	operationStatsNDJSON string
	spanListNDJSON       string
	facetNDJSON          string
	dependencies         *JaegerDependenciesResponse
	err                  error
}

func (m *mockClient) Ping(_ context.Context) error {
	return m.err
}
func (m *mockClient) GetServices(_ context.Context) (*JaegerServicesResponse, error) {
	return m.services, m.err
}
func (m *mockClient) GetOperations(_ context.Context, _ string) (*JaegerOperationsResponse, error) {
	return m.operations, m.err
}
func (m *mockClient) SearchTraces(_ context.Context, _ SearchParams) (*JaegerResponse, error) {
	return m.traces, m.err
}
func (m *mockClient) SearchTracesTempo(_ context.Context, _ TempoSearchParams) (*TempoSearchResponse, error) {
	return m.tempoTraces, m.err
}
func (m *mockClient) QueryTraceList(_ context.Context, _ TraceListParams) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.traceListNDJSON)), nil
}
func (m *mockClient) QueryLogsQLStream(_ context.Context, _, _, _ string) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.traceListNDJSON)), nil
}
func (m *mockClient) QueryOperationDurations(_ context.Context, _, _ string, _ bool, _, _ string) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.durationsNDJSON)), nil
}
func (m *mockClient) QueryHeatmap(_ context.Context, _ string, _ int64, _, _ string, _ entityKind) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.heatmapNDJSON)), nil
}
func (m *mockClient) QueryOperationStats(_ context.Context, _, _, _ string) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.operationStatsNDJSON)), nil
}
func (m *mockClient) QuerySpanList(_ context.Context, _ string, _ int, _, _ string) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.spanListNDJSON)), nil
}
func (m *mockClient) QueryFacet(_ context.Context, _, _ string, _ int, _, _ string) (io.ReadCloser, error) {
	if m.err != nil {
		return nil, m.err
	}
	return io.NopCloser(strings.NewReader(m.facetNDJSON)), nil
}
func (m *mockClient) GetDependencies(_ context.Context, _, _ int64) (*JaegerDependenciesResponse, error) {
	return m.dependencies, m.err
}
func (m *mockClient) QueryLogsQLRange(_ context.Context, _ string, _, _ time.Time, _, _ string) (*LogsQLResponse, error) {
	return nil, m.err
}
func (m *mockClient) QueryLogsQLInstant(_ context.Context, _ string, _ time.Time, _ string) (*LogsQLResponse, error) {
	return nil, m.err
}
func (m *mockClient) QueryLogsQLLogs(_ context.Context, _ string, _, _ time.Time, _ int, _ string) (io.ReadCloser, error) {
	return nil, m.err
}
func (m *mockClient) QueryLogsQLHits(_ context.Context, _ string, _, _ time.Time, _, _ string, _ []string) (io.ReadCloser, error) {
	return nil, m.err
}
func (m *mockClient) QueryLogsQLTail(_ context.Context, _ string) (io.ReadCloser, error) {
	return nil, m.err
}
func (m *mockClient) GetFieldNames(_ context.Context, _, _ string, _, _ time.Time) (*FieldNamesResponse, error) {
	return &FieldNamesResponse{}, m.err
}
func (m *mockClient) GetFieldValues(_ context.Context, _ string, _ int, _, _ string, _, _ time.Time) (*FieldValuesResponse, error) {
	return &FieldValuesResponse{}, m.err
}

func makeQuery(t *testing.T, refID string, qm queryModel) backend.DataQuery {
	t.Helper()
	raw, err := json.Marshal(qm)
	require.NoError(t, err)
	return backend.DataQuery{
		RefID:     refID,
		JSON:      raw,
		TimeRange: backend.TimeRange{From: time.Now().Add(-1 * time.Hour), To: time.Now()},
	}
}

// --- CheckHealth ---

func TestCheckHealth(t *testing.T) {
	tests := []struct {
		name       string
		client     *mockClient
		wantStatus backend.HealthStatus
		wantMsgSub string
	}{
		{
			name:       "reachable",
			client:     &mockClient{services: &JaegerServicesResponse{Data: []string{"svc"}}},
			wantStatus: backend.HealthStatusOk,
		},
		{
			name:       "unreachable",
			client:     &mockClient{err: assert.AnError},
			wantStatus: backend.HealthStatusError,
			wantMsgSub: "cannot reach VictoriaTraces",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ds := &Datasource{client: tc.client}
			resp, err := ds.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, resp.Status)
			if tc.wantMsgSub != "" {
				assert.Contains(t, resp.Message, tc.wantMsgSub)
			}
		})
	}
}

func TestResourceTraceReadsTheStoredSpans(t *testing.T) {
	// The trace comes from LogsQL, not the Jaeger API: attributes, events and
	// scope survive the round trip as stored, and a trace still being ingested
	// answers with more the next time it is asked.
	ds := &Datasource{client: &mockClient{
		traceListNDJSON: `{"trace_id":"t1","span_id":"s1","name":"POST /order",` +
			`"start_time_unix_nano":"1700000000000000000","duration":"25000000",` +
			`"resource_attr:service.name":"checkout","span_attr:http.route":"/order"}` + "\n",
	}}

	sender := &mockSender{}
	require.NoError(t, ds.CallResource(context.Background(), &backend.CallResourceRequest{Path: "trace/t1"}, sender))
	require.Len(t, sender.responses, 1)
	require.Equal(t, http.StatusOK, sender.responses[0].Status)

	var trace JaegerTrace
	require.NoError(t, json.Unmarshal(sender.responses[0].Body, &trace))
	require.Len(t, trace.Spans, 1)
	assert.Equal(t, "POST /order", trace.Spans[0].OperationName)
	assert.Equal(t, "checkout", trace.Spans[0].ProcessID)
	assert.Contains(t, trace.Spans[0].Tags, JaegerKeyValue{Key: "http.route", Type: "string", Value: "/order"})
}

func TestResourceTraceMissing(t *testing.T) {
	// No spans is a normal outcome — the trace expired or never arrived — and
	// the view says so rather than showing an empty waterfall.
	ds := &Datasource{client: &mockClient{traceListNDJSON: ""}}

	sender := &mockSender{}
	require.NoError(t, ds.CallResource(context.Background(), &backend.CallResourceRequest{Path: "trace/t1"}, sender))
	require.Len(t, sender.responses, 1)
	assert.Equal(t, http.StatusNotFound, sender.responses[0].Status)
}

// --- QueryData ---

func TestQueryData(t *testing.T) {
	traces := &JaegerResponse{Data: []JaegerTrace{sampleTrace()}}

	tests := []struct {
		name        string
		client      *mockClient
		queries     []backend.DataQuery
		wantErrRefs []string                                   // RefIDs expected to carry an Error
		check       func(t *testing.T, r backend.DataResponse) // optional per-RefID asserts on first ok response
		checkRefID  string                                     // which RefID the check above applies to
	}{
		{
			name:    "search returns one frame",
			client:  &mockClient{traces: traces},
			queries: []backend.DataQuery{makeQuery(t, "A", queryModel{QueryType: queryTypeSearch, ServiceName: "frontend", Limit: 10})},
			check: func(t *testing.T, r backend.DataResponse) {
				assert.Nil(t, r.Error)
				assert.Len(t, r.Frames, 1)
			},
			checkRefID: "A",
		},
		{
			name: "traceId returns trace + nodes + edges",
			client: &mockClient{
				traceListNDJSON: `{"trace_id":"abc123","span_id":"s1","name":"op","resource_attr:service.name":"checkout"}` + "\n" +
					`{"trace_id":"abc123","span_id":"s2","parent_span_id":"s1","name":"child","resource_attr:service.name":"cart"}` + "\n",
			},
			queries: []backend.DataQuery{makeQuery(t, "B", queryModel{QueryType: queryTypeTraceID, TraceID: "abc123"})},
			check: func(t *testing.T, r backend.DataResponse) {
				assert.Nil(t, r.Error)
				require.Len(t, r.Frames, 3)
				assert.Equal(t, "traces", r.Frames[0].Name)
				assert.Equal(t, "nodes", r.Frames[1].Name)
				assert.Equal(t, "edges", r.Frames[2].Name)
			},
			checkRefID: "B",
		},
		{
			// The charts render in their own Explore panel, which only exists
			// if the response carries a frame addressed to that panel.
			name: "trace list returns the charts frame ahead of the list",
			client: &mockClient{
				traceListNDJSON: `{"trace_id":"t1","spans":"1","errors":"0","duration_ns":"1000","start":"2026-09-11T10:00:00Z","services":"a","root_service":"a","root_operation":"op"}` + "\n",
			},
			queries: []backend.DataQuery{makeQuery(t, "E", queryModel{QueryType: queryTypeTraceList, Limit: 10})},
			check: func(t *testing.T, r backend.DataResponse) {
				assert.Nil(t, r.Error)
				require.Len(t, r.Frames, 2)
				// Explore stacks custom panels in frame order, so the charts
				// come first and the list sits under them.
				assert.Equal(t, "trace_charts", r.Frames[0].Name)
				assert.Equal(t, "trace_list", r.Frames[1].Name)
				// Explore gives a custom panel no request, so the query it is
				// showing has to travel on the frame.
				for _, f := range r.Frames {
					custom := f.Meta.Custom.(map[string]interface{})
					assert.Contains(t, string(custom["query"].(json.RawMessage)), "traceList", f.Name)
				}
			},
			checkRefID: "E",
		},
		{
			name: "span list carries the charts frame too",
			client: &mockClient{
				traceListNDJSON: `{"trace_id":"t1","span_id":"s1","service_name":"a","name":"op","duration_ns":"1000","start":"2026-09-11T10:00:00Z"}` + "\n",
			},
			queries: []backend.DataQuery{makeQuery(t, "F", queryModel{QueryType: queryTypeSpanList, Limit: 10})},
			check: func(t *testing.T, r backend.DataResponse) {
				assert.Nil(t, r.Error)
				require.Len(t, r.Frames, 2)
				assert.Equal(t, "trace_charts", r.Frames[0].Name)
			},
			checkRefID: "F",
		},
		{
			// One path for a trace, whichever way it is asked for: the panel's
			// resource and this query both read the stored spans, so a trace
			// that one can show the other can too.
			name: "traceId builds the trace from the stored spans",
			client: &mockClient{
				traceListNDJSON: `{"trace_id":"abc","span_id":"s1","name":"POST /order",` +
					`"start_time_unix_nano":"1700000000000000000","duration":"25000000",` +
					`"resource_attr:service.name":"checkout"}` + "\n",
			},
			queries: []backend.DataQuery{makeQuery(t, "G", queryModel{QueryType: queryTypeTraceID, TraceID: "abc"})},
			check: func(t *testing.T, r backend.DataResponse) {
				assert.Nil(t, r.Error)
				require.Len(t, r.Frames, 3)
				assert.Equal(t, "traces", r.Frames[0].Name)
				assert.Equal(t, 1, r.Frames[0].Rows())
			},
			checkRefID: "G",
		},
		{
			name:        "traceId without ID errors",
			client:      &mockClient{},
			queries:     []backend.DataQuery{makeQuery(t, "C", queryModel{QueryType: queryTypeTraceID, TraceID: ""})},
			wantErrRefs: []string{"C"},
		},
		{
			name:   "invalid JSON errors",
			client: &mockClient{},
			queries: []backend.DataQuery{
				{RefID: "D", JSON: []byte("{bad json")},
			},
			wantErrRefs: []string{"D"},
		},
		{
			name:   "multiple queries are routed by RefID",
			client: &mockClient{traces: traces},
			queries: []backend.DataQuery{
				makeQuery(t, "A", queryModel{QueryType: queryTypeSearch}),
				makeQuery(t, "B", queryModel{QueryType: queryTypeSearch}),
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ds := &Datasource{client: tc.client}
			resp, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{Queries: tc.queries})
			require.NoError(t, err)

			// Every query must produce a response keyed by its RefID.
			for _, q := range tc.queries {
				assert.Contains(t, resp.Responses, q.RefID, "missing response for RefID %q", q.RefID)
			}
			for _, refID := range tc.wantErrRefs {
				assert.NotNil(t, resp.Responses[refID].Error, "expected error on RefID %q", refID)
			}
			if tc.check != nil {
				tc.check(t, resp.Responses[tc.checkRefID])
			}
		})
	}
}

// --- CallResource ---

type mockSender struct {
	responses []*backend.CallResourceResponse
}

func (s *mockSender) Send(r *backend.CallResourceResponse) error {
	s.responses = append(s.responses, r)
	return nil
}

func TestCallResource(t *testing.T) {
	tests := []struct {
		name       string
		client     *mockClient
		req        *backend.CallResourceRequest
		wantStatus int
		check      func(t *testing.T, body []byte)
	}{
		{
			name:       "services returns service list",
			client:     &mockClient{services: &JaegerServicesResponse{Data: []string{"svc-a", "svc-b"}}},
			req:        &backend.CallResourceRequest{Path: "services"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				var result []string
				require.NoError(t, json.Unmarshal(body, &result))
				assert.Equal(t, []string{"svc-a", "svc-b"}, result)
			},
		},
		{
			name:       "operations parses service from query string",
			client:     &mockClient{operations: &JaegerOperationsResponse{Data: []string{"op1", "op2"}}},
			req:        &backend.CallResourceRequest{Path: "operations", URL: "service=frontend"},
			wantStatus: http.StatusOK,
		},
		{
			name: "search returns tempo trace summaries",
			client: &mockClient{tempoTraces: &TempoSearchResponse{Traces: []TempoTraceSummary{
				{TraceID: "abc", RootServiceName: "frontend", RootTraceName: "GET /", StartTimeUnixNano: 1_700_000_000_000_000_000, DurationMs: 12},
			}}},
			req:        &backend.CallResourceRequest{Path: "search", URL: "search?q=*&start=1700000000&end=1700003600&limit=10"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				var result []TempoTraceSummary
				require.NoError(t, json.Unmarshal(body, &result))
				require.Len(t, result, 1)
				assert.Equal(t, "abc", result[0].TraceID)
			},
		},
		{
			// A nil Traces slice must serialise as [] so the frontend can map over it.
			name:       "search with no results returns an empty array",
			client:     &mockClient{tempoTraces: &TempoSearchResponse{}},
			req:        &backend.CallResourceRequest{Path: "search"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				assert.JSONEq(t, `[]`, string(body))
			},
		},
		{
			name: "trace returns the single trace",
			// Read from the stored spans, not the Jaeger API.
			client:     &mockClient{traceListNDJSON: `{"trace_id":"abc","span_id":"s1","name":"op"}` + "\n"},
			req:        &backend.CallResourceRequest{Path: "trace/abc"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				var result JaegerTrace
				require.NoError(t, json.Unmarshal(body, &result))
				assert.Equal(t, "abc", result.TraceID)
			},
		},
		{
			name:       "trace with no data returns 404",
			client:     &mockClient{traces: &JaegerResponse{}},
			req:        &backend.CallResourceRequest{Path: "trace/missing"},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "trace without an id returns 400",
			client:     &mockClient{},
			req:        &backend.CallResourceRequest{Path: "trace/"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "dependencies returns graph edges",
			client: &mockClient{dependencies: &JaegerDependenciesResponse{Data: []ServiceDependency{
				{Parent: "frontend", Child: "backend", CallCount: 7},
			}}},
			req:        &backend.CallResourceRequest{Path: "dependencies", URL: "dependencies?endTs=1700000000000&lookback=3600000"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				var result []ServiceDependency
				require.NoError(t, json.Unmarshal(body, &result))
				assert.Equal(t, int64(7), result[0].CallCount)
			},
		},
		{
			name:       "dependencies with no edges returns an empty array",
			client:     &mockClient{dependencies: &JaegerDependenciesResponse{}},
			req:        &backend.CallResourceRequest{Path: "dependencies"},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				assert.JSONEq(t, `[]`, string(body))
			},
		},
		{
			name:       "unknown path returns 404",
			client:     &mockClient{},
			req:        &backend.CallResourceRequest{Path: "unknown"},
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ds := &Datasource{client: tc.client}
			sender := &mockSender{}
			require.NoError(t, ds.CallResource(context.Background(), tc.req, sender))
			require.Len(t, sender.responses, 1)
			assert.Equal(t, tc.wantStatus, sender.responses[0].Status)
			if tc.check != nil {
				tc.check(t, sender.responses[0].Body)
			}
		})
	}
}
