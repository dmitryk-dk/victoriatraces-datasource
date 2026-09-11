package plugin

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildFacetQuery(t *testing.T) {
	t.Run("counts distinct traces per value, busiest first", func(t *testing.T) {
		q := buildFacetQuery("", "resource_attr:service.name", 0)
		assert.Contains(t, q, `| stats by ("resource_attr:service.name") count_uniq(trace_id) n`)
		assert.Contains(t, q, "| sort by (n desc)")
		assert.Contains(t, q, "| limit 100")
	})

	t.Run("counts traces rather than spans", func(t *testing.T) {
		// count() would report spans and overstate every multi-span service,
		// disagreeing with the list the sidebar sits beside.
		q := buildFacetQuery("", "name", 0)
		assert.NotContains(t, q, "count() n")
	})

	t.Run("quotes the field so it cannot inject syntax", func(t *testing.T) {
		assert.Contains(t, buildFacetQuery("", `a"b`, 0), `stats by ("a\"b")`)
	})

	t.Run("keeps a caller-supplied where clause", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(buildFacetQuery("status_code:2", "name", 5), "status_code:2 | stats"))
	})

	t.Run("defaults the where clause", func(t *testing.T) {
		assert.True(t, strings.HasPrefix(buildFacetQuery("", "name", 5), defaultTraceListWhere+" | stats"))
	})
}

func TestParseFacetValues(t *testing.T) {
	const field = "resource_attr:service.name"

	t.Run("parses values and counts", func(t *testing.T) {
		body := strings.Join([]string{
			`{"resource_attr:service.name":"frontend","n":"2903"}`,
			`{"resource_attr:service.name":"cart","n":"964"}`,
		}, "\n")

		values, err := parseFacetValues(strings.NewReader(body), field)
		require.NoError(t, err)
		assert.Equal(t, []FacetValue{
			{Value: "frontend", Count: 2903},
			{Value: "cart", Count: 964},
		}, values)
	})

	t.Run("drops rows whose value is empty", func(t *testing.T) {
		// An absent field is not something to offer as a filter.
		body := `{"resource_attr:service.name":"","n":"5"}`
		values, err := parseFacetValues(strings.NewReader(body), field)
		require.NoError(t, err)
		assert.Empty(t, values)
	})

	t.Run("skips malformed lines", func(t *testing.T) {
		body := strings.Join([]string{`nonsense`, `{"resource_attr:service.name":"ok","n":"1"}`}, "\n")
		values, err := parseFacetValues(strings.NewReader(body), field)
		require.NoError(t, err)
		require.Len(t, values, 1)
		assert.Equal(t, "ok", values[0].Value)
	})

	t.Run("empty body yields an empty slice, not nil", func(t *testing.T) {
		values, err := parseFacetValues(strings.NewReader(""), field)
		require.NoError(t, err)
		assert.NotNil(t, values)
		assert.Empty(t, values)
	})
}
