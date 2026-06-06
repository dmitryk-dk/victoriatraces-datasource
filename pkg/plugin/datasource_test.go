package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockClient is a test double for victoriaTracesClient.
type mockClient struct {
	services   *JaegerServicesResponse
	operations *JaegerOperationsResponse
	traces     *JaegerResponse
	err        error
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
func (m *mockClient) GetTrace(_ context.Context, _ string) (*JaegerResponse, error) {
	return m.traces, m.err
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
func (m *mockClient) GetFieldNames(_ context.Context, _, _ string) (*FieldNamesResponse, error) {
	return &FieldNamesResponse{}, m.err
}
func (m *mockClient) GetFieldValues(_ context.Context, _ string, _ int, _, _ string) (*FieldValuesResponse, error) {
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
			name:    "traceId returns trace + nodes + edges",
			client:  &mockClient{traces: traces},
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
