package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// FacetValue is one selectable value in a facet group, with the number of
// traces that carry it.
type FacetValue struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

// Facet is one facet group: a span field and its most common values.
type Facet struct {
	Field  string       `json:"field"`
	Values []FacetValue `json:"values"`
}

// facetValuesLimit caps the values offered per group. The sidebar is for
// picking common values; a field with more distinct values than this is better
// served by the tag filter's free-text input.
const facetValuesLimit = 100

// buildFacetQuery counts distinct traces per value of one field.
//
// count_uniq(trace_id) rather than count(): the sidebar sits beside a list of
// traces, so "how many traces involve this service" is the number that matches
// what selecting it will show. A plain count would report spans and overstate
// every multi-span service.
func buildFacetQuery(where, field string, limit int) string {
	if where == "" {
		where = defaultTraceListWhere
	}
	if limit <= 0 {
		limit = facetValuesLimit
	}
	return fmt.Sprintf(
		"%s | stats by (%s) count_uniq(trace_id) n | sort by (n desc) | limit %d",
		where, logsqlQuoteValue(field), limit,
	)
}

// parseFacetValues reads the NDJSON body of a facet query. Rows whose value is
// empty are dropped: an absent field is not something to filter on.
func parseFacetValues(body io.Reader, field string) ([]FacetValue, error) {
	out := []FacetValue{}

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 16*1024), maxTraceListLineBytes)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var o map[string]string
		if err := json.Unmarshal([]byte(line), &o); err != nil {
			continue
		}
		value := o[field]
		if value == "" {
			continue
		}
		count, _ := strconv.ParseInt(o["n"], 10, 64)
		out = append(out, FacetValue{Value: value, Count: count})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading facet response: %w", err)
	}
	return out, nil
}

// collectFacets runs one query per requested field.
//
// Sequential rather than concurrent: the sidebar asks for a couple of fields,
// and issuing them in order keeps the load on VictoriaTraces predictable.
func (d *Datasource) collectFacets(ctx context.Context, where string, fields []string, start, end string) ([]Facet, error) {
	facets := make([]Facet, 0, len(fields))

	for _, field := range fields {
		if field == "" {
			continue
		}

		body, err := d.client.QueryFacet(ctx, where, field, facetValuesLimit, start, end)
		if err != nil {
			return nil, err
		}

		values, err := parseFacetValues(body, field)
		closeBody(body)
		if err != nil {
			return nil, err
		}

		facets = append(facets, Facet{Field: field, Values: values})
	}

	return facets, nil
}
