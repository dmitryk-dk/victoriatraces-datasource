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
				_ = json.NewEncoder(w).Encode(JaegerResponse{
					Data: []JaegerTrace{{TraceID: "abc123"}},
				})
			},
			action: func(t *testing.T, c *Client) {
				resp, err := c.GetTrace(context.Background(), "abc123")
				require.NoError(t, err)
				require.Len(t, resp.Data, 1)
				assert.Equal(t, "abc123", resp.Data[0].TraceID)
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
