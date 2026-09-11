package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// clientCase drives the request-shape tests below.
//   - handler: validates the incoming request and writes a canned response.
//   - action:  invokes the Client method under test.
//   - check:   asserts on the returned value/error.
type clientCase struct {
	name    string
	handler func(t *testing.T, w http.ResponseWriter, r *http.Request)
	action  func(t *testing.T, c *Client)
}

func runClientCases(t *testing.T, cases []clientCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tc.handler(t, w, r)
			}))
			defer srv.Close()

			tc.action(t, NewClient(srv.URL, nil))
		})
	}
}

func TestClient_RequestShapes(t *testing.T) {
	runClientCases(t, []clientCase{
		{
			name: "GetServices",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/jaeger/api/services", r.URL.Path)
				assert.Equal(t, "application/json", r.Header.Get("Accept"))
				_ = json.NewEncoder(w).Encode(JaegerServicesResponse{
					Data: []string{"frontend", "backend", "database"},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.GetServices(context.Background())
				require.NoError(t, err)
				assert.Equal(t, []string{"frontend", "backend", "database"}, resp.Data)
			},
		},
		{
			name: "GetOperations uses path-based service",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/jaeger/api/services/frontend/operations", r.URL.Path)
				_ = json.NewEncoder(w).Encode(JaegerOperationsResponse{
					Data: []string{"HTTP GET /api", "HTTP POST /login"},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.GetOperations(context.Background(), "frontend")
				require.NoError(t, err)
				assert.Equal(t, []string{"HTTP GET /api", "HTTP POST /login"}, resp.Data)
			},
		},
		{
			name: "SearchTraces basic params",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/jaeger/api/traces", r.URL.Path)
				assert.Equal(t, "frontend", r.URL.Query().Get("service"))
				assert.Equal(t, "HTTP GET /api", r.URL.Query().Get("operation"))
				assert.Equal(t, "10", r.URL.Query().Get("limit"))
				_ = json.NewEncoder(w).Encode(JaegerResponse{
					Data: []JaegerTrace{{TraceID: "trace1"}},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.SearchTraces(context.Background(), SearchParams{
					Service:   "frontend",
					Operation: "HTTP GET /api",
					Start:     time.Unix(0, 0),
					End:       time.Unix(60, 0),
					Limit:     10,
				})
				require.NoError(t, err)
				require.Len(t, resp.Data, 1)
				assert.Equal(t, "trace1", resp.Data[0].TraceID)
			},
		},
		{
			name: "SearchTraces tags become JSON object",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				got := r.URL.Query().Get("tags")
				var parsed map[string]string
				require.NoError(t, json.Unmarshal([]byte(got), &parsed))
				assert.Equal(t, "true", parsed["error"])
				assert.Equal(t, "500", parsed["http.status_code"])
				_ = json.NewEncoder(w).Encode(JaegerResponse{})
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.SearchTraces(context.Background(), SearchParams{
					Service: "svc",
					Tags:    "error=true http.status_code=500",
				})
				require.NoError(t, err)
			},
		},
		{
			name: "SearchTraces omits empty filters",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Empty(t, r.URL.Query().Get("service"))
				assert.Empty(t, r.URL.Query().Get("operation"))
				_ = json.NewEncoder(w).Encode(JaegerResponse{})
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.SearchTraces(context.Background(), SearchParams{})
				require.NoError(t, err)
			},
		},
		{
			name: "GetTrace by ID",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/jaeger/api/traces/abc123", r.URL.Path)
				// The range is required: without it the upstream reports the
				// trace as out of retention rather than searching for it.
				assert.Equal(t, "0", r.URL.Query().Get("start"))
				assert.Equal(t, "60000000", r.URL.Query().Get("end"))
				_ = json.NewEncoder(w).Encode(JaegerResponse{
					Data: []JaegerTrace{{TraceID: "abc123"}},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.GetTrace(context.Background(), "abc123", time.Unix(0, 0), time.Unix(60, 0))
				require.NoError(t, err)
				require.Len(t, resp.Data, 1)
				assert.Equal(t, "abc123", resp.Data[0].TraceID)
			},
		},
	})
}

func TestClient_MetadataAndSearchScoping(t *testing.T) {
	start := time.Unix(1_700_000_000, 0).UTC()
	end := time.Unix(1_700_003_600, 0).UTC()

	runClientCases(t, []clientCase{
		{
			name: "GetFieldNames scopes to the time range",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				// Suggestions taken from the whole retention window include
				// keys that no longer exist in the range being looked at.
				assert.Equal(t, "1700000000", r.URL.Query().Get("start"))
				assert.Equal(t, "1700003600", r.URL.Query().Get("end"))
				_, _ = w.Write([]byte(`{"values":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.GetFieldNames(context.Background(), "", "", start, end)
				require.NoError(t, err)
			},
		},
		{
			name: "GetFieldNames omits an absent range",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Empty(t, r.URL.Query().Get("start"))
				assert.Empty(t, r.URL.Query().Get("end"))
				_, _ = w.Write([]byte(`{"values":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.GetFieldNames(context.Background(), "", "", time.Time{}, time.Time{})
				require.NoError(t, err)
			},
		},
		{
			name: "GetFieldValues scopes to the time range",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "1700000000", r.URL.Query().Get("start"))
				assert.Equal(t, "1700003600", r.URL.Query().Get("end"))
				_, _ = w.Write([]byte(`{"values":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.GetFieldValues(context.Background(), "span_attr:http.route", 10, "", "", start, end)
				require.NoError(t, err)
			},
		},
		{
			name: "SearchTraces forwards duration bounds",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "100ms", r.URL.Query().Get("minDuration"))
				assert.Equal(t, "2s", r.URL.Query().Get("maxDuration"))
				_, _ = w.Write([]byte(`{"data":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.SearchTraces(context.Background(), SearchParams{
					MinDuration: "100ms",
					MaxDuration: "2s",
				})
				require.NoError(t, err)
			},
		},
		{
			name: "SearchTraces omits absent duration bounds",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Empty(t, r.URL.Query().Get("minDuration"))
				assert.Empty(t, r.URL.Query().Get("maxDuration"))
				_, _ = w.Write([]byte(`{"data":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.SearchTraces(context.Background(), SearchParams{})
				require.NoError(t, err)
			},
		},
	})
}

func TestClient_TransportErrors(t *testing.T) {
	tests := []struct {
		name         string
		handler      http.HandlerFunc
		wantErrSub   string
		wantNotFound bool
	}{
		{
			name: "non-2xx propagates status",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte("internal error"))
			},
			wantErrSub: "500",
		},
		{
			name: "invalid JSON surfaces decode error",
			handler: func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte("not json"))
			},
			wantErrSub: "decoding response",
		},
		{
			name: "404 with Jaeger error body extracts msg and is detectable",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"data":[],"errors":[{"code":404,"msg":"trace not found"}]}`))
			},
			wantErrSub:   "trace not found",
			wantNotFound: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()

			_, err := NewClient(srv.URL, nil).GetServices(context.Background())
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErrSub)
			if tc.wantNotFound {
				assert.True(t, IsNotFound(err), "IsNotFound should match")
			}
		})
	}
}

func TestTagsToJSON(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantKeys  map[string]string
		wantEmpty bool
	}{
		{name: "single pair", input: "error=true", wantKeys: map[string]string{"error": "true"}},
		{name: "multiple pairs", input: "error=true http.status_code=500", wantKeys: map[string]string{"error": "true", "http.status_code": "500"}},
		{name: "empty string", input: "", wantEmpty: true},
		{name: "whitespace only", input: "   ", wantEmpty: true},
		{name: "no equals sign", input: "noequals", wantEmpty: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := tagsToJSON(tc.input)
			if tc.wantEmpty {
				assert.Empty(t, result)
				return
			}
			var parsed map[string]string
			require.NoError(t, json.Unmarshal([]byte(result), &parsed))
			assert.Equal(t, tc.wantKeys, parsed)
		})
	}
}

func TestClient_TempoAndDependencies(t *testing.T) {
	runClientCases(t, []clientCase{
		{
			name: "SearchTracesTempo sends cursor paging params",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/tempo/api/search", r.URL.Path)
				q := r.URL.Query()
				assert.Equal(t, `_msg:"error"`, q.Get("q"))
				assert.Equal(t, "1700000000", q.Get("start"))
				assert.Equal(t, "1700003600", q.Get("end"))
				assert.Equal(t, "25", q.Get("limit"))
				_, _ = w.Write([]byte(`{"traces":[{"traceID":"abc","rootServiceName":"frontend","rootTraceName":"GET /","startTimeUnixNano":1700000000000000000,"durationMs":12}]}`))
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.SearchTracesTempo(context.Background(), TempoSearchParams{
					Query: `_msg:"error"`,
					Start: time.Unix(1700000000, 0),
					End:   time.Unix(1700003600, 0),
					Limit: 25,
				})
				require.NoError(t, err)
				require.Len(t, resp.Traces, 1)
				assert.Equal(t, "abc", resp.Traces[0].TraceID)
				assert.Equal(t, FlexInt64(1700000000000000000), resp.Traces[0].StartTimeUnixNano)
				assert.Equal(t, FlexInt64(12), resp.Traces[0].DurationMs)
			},
		},
		{
			name: "SearchTracesTempo defaults an empty query to match-all",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				// Not "*": the Tempo endpoint rejects it as a compound token.
				assert.Equal(t, "{}", r.URL.Query().Get("q"))
				_, _ = w.Write([]byte(`{"traces":[]}`))
			},
			action: func(t *testing.T, c *Client) {
				_, err := c.SearchTracesTempo(context.Background(), TempoSearchParams{})
				require.NoError(t, err)
			},
		},
		{
			name: "GetDependencies sends endTs and lookback",
			handler: func(t *testing.T, w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/select/jaeger/api/dependencies", r.URL.Path)
				assert.Equal(t, "1700000000000", r.URL.Query().Get("endTs"))
				assert.Equal(t, "3600000", r.URL.Query().Get("lookback"))
				_ = json.NewEncoder(w).Encode(JaegerDependenciesResponse{
					Data: []ServiceDependency{{Parent: "frontend", Child: "backend", CallCount: 7}},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.GetDependencies(context.Background(), 1700000000000, 3600000)
				require.NoError(t, err)
				require.Len(t, resp.Data, 1)
				assert.Equal(t, int64(7), resp.Data[0].CallCount)
			},
		},
	})
}

func TestFlexInt64_Unmarshal(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		want    FlexInt64
		wantErr bool
	}{
		{name: "bare number", json: `1700000000000000000`, want: 1700000000000000000},
		{name: "quoted number", json: `"1700000000000000000"`, want: 1700000000000000000},
		{name: "fractional value truncates", json: `12.9`, want: 12},
		{name: "null becomes zero", json: `null`, want: 0},
		{name: "empty string becomes zero", json: `""`, want: 0},
		{name: "non-numeric fails", json: `"abc"`, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got FlexInt64
			err := json.Unmarshal([]byte(tc.json), &got)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
