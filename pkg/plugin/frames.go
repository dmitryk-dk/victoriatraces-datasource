package plugin

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// mustMarshal marshals v to JSON, returning an empty array on error.
func mustMarshal(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("[]")
	}
	return json.RawMessage(b)
}

// kvToRaw converts a slice of JaegerKeyValue to a JSON-encoded array of {key, value} objects.
func kvToRaw(kvs []JaegerKeyValue) json.RawMessage {
	type kv struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}
	out := make([]kv, 0, len(kvs))
	for _, item := range kvs {
		out = append(out, kv{Key: item.Key, Value: item.Value})
	}
	return mustMarshal(out)
}

// logsToRaw converts span logs to a JSON-encoded array for Grafana's trace panel.
func logsToRaw(logs []JaegerLog) json.RawMessage {
	type logField struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}
	type logEntry struct {
		Timestamp float64    `json:"timestamp"` // ms
		Fields    []logField `json:"fields"`
	}
	out := make([]logEntry, 0, len(logs))
	for _, l := range logs {
		fields := make([]logField, 0, len(l.Fields))
		for _, f := range l.Fields {
			fields = append(fields, logField{Key: f.Key, Value: f.Value})
		}
		out = append(out, logEntry{Timestamp: float64(l.Timestamp) / 1000.0, Fields: fields})
	}
	return mustMarshal(out)
}

// refsToRaw converts FOLLOWS_FROM references to JSON (CHILD_OF is covered by parentSpanID).
func refsToRaw(refs []JaegerReference) json.RawMessage {
	type ref struct {
		TraceID string `json:"traceID"`
		SpanID  string `json:"spanID"`
	}
	out := make([]ref, 0)
	for _, r := range refs {
		if r.RefType == "CHILD_OF" {
			continue
		}
		out = append(out, ref{TraceID: r.TraceID, SpanID: r.SpanID})
	}
	return mustMarshal(out)
}

// TracesToFrame converts a slice of JaegerTraces into a Grafana data frame
// suitable for the Grafana traces panel (full span-level detail).
// Field types must match what Grafana's TraceView expects:
// - startTime/duration: float64 (FieldType.number), NOT int64
// - tags/serviceTags/logs/references: json.RawMessage (FieldType.other)
func TracesToFrame(traces []JaegerTrace) *data.Frame {
	var (
		traceIDs       []string
		spanIDs        []string
		parentSpanIDs  []string
		operationNames []string
		serviceNames   []string
		startTimes     []float64
		durations      []float64
		tags           []json.RawMessage
		serviceTags    []json.RawMessage
		logs           []json.RawMessage
		references     []json.RawMessage
	)

	for _, trace := range traces {
		for _, span := range trace.Spans {
			process, ok := trace.Processes[span.ProcessID]
			if !ok {
				process = JaegerProcess{ServiceName: "unknown"}
			}

			parentSpanID := ""
			for _, ref := range span.References {
				if ref.RefType == "CHILD_OF" {
					parentSpanID = ref.SpanID
					break
				}
			}

			traceIDs = append(traceIDs, span.TraceID)
			spanIDs = append(spanIDs, span.SpanID)
			parentSpanIDs = append(parentSpanIDs, parentSpanID)
			operationNames = append(operationNames, span.OperationName)
			serviceNames = append(serviceNames, process.ServiceName)
			// Convert microseconds → milliseconds for Grafana (float64 = FieldType.number)
			startTimes = append(startTimes, float64(span.StartTime)/1000.0)
			durations = append(durations, float64(span.Duration)/1000.0)
			tags = append(tags, kvToRaw(span.Tags))
			serviceTags = append(serviceTags, kvToRaw(process.Tags))
			logs = append(logs, logsToRaw(span.Logs))
			references = append(references, refsToRaw(span.References))
		}
	}

	frame := data.NewFrame("traces",
		data.NewField("traceID", nil, traceIDs),
		data.NewField("spanID", nil, spanIDs),
		data.NewField("parentSpanID", nil, parentSpanIDs),
		data.NewField("operationName", nil, operationNames),
		data.NewField("serviceName", nil, serviceNames),
		data.NewField("serviceTags", nil, serviceTags),
		data.NewField("startTime", nil, startTimes),
		data.NewField("duration", nil, durations),
		data.NewField("logs", nil, logs),
		data.NewField("references", nil, references),
		data.NewField("tags", nil, tags),
	)

	// Render in our custom panel. Using "trace" PreferredVisualization
	// puts this in a separate panel section from nodeGraph frames.
	frame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "trace",
		PreferredVisualizationPluginID: "victoriametrics-traces-panel",
	})

	return frame
}

// TraceListRowsToFrame renders the LogsQL trace-list aggregation as a frame.
//
// Unlike TraceSearchResultToFrame, which derives its columns from whole traces
// fetched via the Jaeger API, these rows are already aggregated per trace, so
// span and error counts are exact and no spans need to be transferred.
func TraceListRowsToFrame(rows []TraceListRow, customFields []string, dsUID string) *data.Frame {
	var (
		traceIDs       []string
		rootServices   []string
		rootOperations []string
		serviceLists   []string
		startTimes     []time.Time
		durationsMs    []float64
		spanCounts     []int64
		errorCounts    []int64
		matchedSpans   []string
		partials       []bool
	)

	for _, row := range rows {
		// A row whose timestamp will not parse cannot be placed on the time
		// axis; skip it rather than anchoring it to the epoch.
		startTime, err := time.Parse(time.RFC3339Nano, row.StartTime)
		if err != nil {
			continue
		}

		traceIDs = append(traceIDs, row.TraceID)
		rootServices = append(rootServices, row.RootService)
		rootOperations = append(rootOperations, row.RootOperation)
		// The services set is variable-length, so it travels as JSON in one
		// column rather than forcing a fixed column per service.
		serviceLists = append(serviceLists, marshalServices(row.Services))
		startTimes = append(startTimes, startTime)
		durationsMs = append(durationsMs, float64(row.DurationMicros)/1000.0)
		spanCounts = append(spanCounts, int64(row.Spans))
		errorCounts = append(errorCounts, int64(row.Errors))
		matchedSpans = append(matchedSpans, row.MatchedSpanID)
		partials = append(partials, row.Partial)
	}

	// One column per requested field, named "attr:<field>" so the panel can tell
	// them apart from the fixed columns.
	attrColumns := make(map[string][]string, len(customFields))
	for _, field := range customFields {
		if field == "" {
			continue
		}
		values := make([]string, 0, len(traceIDs))
		for _, row := range rows {
			if _, err := time.Parse(time.RFC3339Nano, row.StartTime); err != nil {
				continue
			}
			values = append(values, row.Attrs[field])
		}
		attrColumns[field] = values
	}

	frame := data.NewFrame("trace_list",
		data.NewField("traceID", nil, traceIDs),
		data.NewField("rootService", nil, rootServices),
		data.NewField("rootOperation", nil, rootOperations),
		data.NewField("services", nil, serviceLists),
		data.NewField("startTime", nil, startTimes),
		data.NewField("durationMs", nil, durationsMs),
		data.NewField("spans", nil, spanCounts),
		data.NewField("errors", nil, errorCounts),
		data.NewField("matchedSpanID", nil, matchedSpans),
		data.NewField("partial", nil, partials),
	)

	for _, field := range customFields {
		if values, ok := attrColumns[field]; ok {
			frame.Fields = append(frame.Fields, data.NewField("attr:"+field, nil, values))
		}
	}

	frame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "trace",
		PreferredVisualizationPluginID: "victoriametrics-traces-panel",
		Custom:                         map[string]interface{}{"datasourceUid": dsUID},
	})

	return frame
}

// marshalServices encodes the per-trace service set for its frame column.
func marshalServices(services []string) string {
	if len(services) == 0 {
		return "[]"
	}
	b, err := json.Marshal(services)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// SpanListRowsToFrame renders individual spans as a frame. Shares the panel
// with the trace list; the frame name is what tells them apart.
func SpanListRowsToFrame(rows []SpanListRow, customFields []string, dsUID string) *data.Frame {
	var (
		traceIDs    []string
		spanIDs     []string
		services    []string
		operations  []string
		startTimes  []time.Time
		durationsMs []float64
		kinds       []string
		statusCodes []int64
	)

	kept := make([]SpanListRow, 0, len(rows))
	for _, row := range rows {
		startTime, err := time.Parse(time.RFC3339Nano, row.StartTime)
		if err != nil {
			continue
		}
		kept = append(kept, row)

		traceIDs = append(traceIDs, row.TraceID)
		spanIDs = append(spanIDs, row.SpanID)
		services = append(services, row.Service)
		operations = append(operations, row.Operation)
		startTimes = append(startTimes, startTime)
		durationsMs = append(durationsMs, float64(row.DurationMicros)/1000.0)
		kinds = append(kinds, row.Kind)
		statusCodes = append(statusCodes, int64(row.StatusCode))
	}

	frame := data.NewFrame("span_list",
		data.NewField("traceID", nil, traceIDs),
		data.NewField("spanID", nil, spanIDs),
		data.NewField("service", nil, services),
		data.NewField("operation", nil, operations),
		data.NewField("startTime", nil, startTimes),
		data.NewField("durationMs", nil, durationsMs),
		data.NewField("kind", nil, kinds),
		data.NewField("statusCode", nil, statusCodes),
	)

	for _, field := range customFields {
		if field == "" {
			continue
		}
		values := make([]string, 0, len(kept))
		for _, row := range kept {
			values = append(values, row.Attrs[field])
		}
		frame.Fields = append(frame.Fields, data.NewField("attr:"+field, nil, values))
	}

	frame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "trace",
		PreferredVisualizationPluginID: "victoriametrics-traces-panel",
		Custom:                         map[string]interface{}{"datasourceUid": dsUID},
	})

	return frame
}

// TraceSearchResultToFrame builds a summary frame for trace search results —
// one row per trace, used in Explore's trace list view.
// Field names match what Grafana's Explore trace search panel expects (same as Tempo).
func TraceSearchResultToFrame(traces []JaegerTrace) *data.Frame {
	var (
		traceIDs           []string
		traceNames         []string
		rootServiceNames   []string
		rootOperationNames []string
		startTimes         []float64
		durationMs         []float64
		spanCounts         []int64
		errorCounts        []int64
	)

	for _, trace := range traces {
		if len(trace.Spans) == 0 {
			continue
		}

		root := findRootSpan(trace)

		process, ok := trace.Processes[root.ProcessID]
		if !ok {
			process = JaegerProcess{ServiceName: "unknown"}
		}

		// Compute overall trace bounds across all spans
		minStart := root.StartTime
		maxEnd := root.StartTime + root.Duration
		for _, s := range trace.Spans {
			if s.StartTime < minStart {
				minStart = s.StartTime
			}
			if end := s.StartTime + s.Duration; end > maxEnd {
				maxEnd = end
			}
		}

		var errCount int64
		for _, s := range trace.Spans {
			if spanHasError(s) {
				errCount++
			}
		}

		traceIDs = append(traceIDs, trace.TraceID)
		traceNames = append(traceNames, fmt.Sprintf("%s: %s", process.ServiceName, root.OperationName))
		rootServiceNames = append(rootServiceNames, process.ServiceName)
		rootOperationNames = append(rootOperationNames, root.OperationName)
		startTimes = append(startTimes, float64(minStart)/1000.0) // µs → ms
		durationMs = append(durationMs, float64(maxEnd-minStart)/1000.0)
		spanCounts = append(spanCounts, int64(len(trace.Spans)))
		errorCounts = append(errorCounts, errCount)
	}

	frame := data.NewFrame("trace_search",
		data.NewField("traceID", nil, traceIDs),
		data.NewField("traceName", nil, traceNames),
		data.NewField("rootServiceName", nil, rootServiceNames),
		data.NewField("rootTraceName", nil, rootOperationNames),
		data.NewField("startTime", nil, startTimes),
		data.NewField("traceDuration", nil, durationMs),
		data.NewField("spanCount", nil, spanCounts),
		data.NewField("errorCount", nil, errorCounts),
	)

	frame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "trace",
		PreferredVisualizationPluginID: "victoriametrics-traces-panel",
	})

	return frame
}

// findRootSpan returns the root span of a trace (the span with no CHILD_OF reference).
func findRootSpan(trace JaegerTrace) JaegerSpan {
	root := trace.Spans[0]
	for _, s := range trace.Spans {
		hasParent := false
		for _, ref := range s.References {
			if ref.RefType == "CHILD_OF" {
				hasParent = true
				break
			}
		}
		if !hasParent {
			root = s
			break
		}
	}
	return root
}

// serviceForSpan returns the service name for the given span ID within a trace.
func serviceForSpan(trace JaegerTrace, spanID string) string {
	for _, s := range trace.Spans {
		if s.SpanID == spanID {
			if p, ok := trace.Processes[s.ProcessID]; ok {
				return p.ServiceName
			}
			return "unknown"
		}
	}
	return ""
}

// spanHasError reports whether a span failed.
//
// Two spellings reach here. The Jaeger API synthesises `error=true`; spans
// rebuilt from LogsQL (trace-by-ID) carry the stored OTLP status instead, as
// `otel.status_code` — 0 unset, 1 ok, 2 error. Matching only the first left a
// failing trace drawing an all-green node graph.
func spanHasError(span JaegerSpan) bool {
	for _, tag := range span.Tags {
		switch tag.Key {
		case "error":
			switch v := tag.Value.(type) {
			case bool:
				if v {
					return true
				}
			case string:
				if v == "true" {
					return true
				}
			}
		case "otel.status_code":
			switch v := tag.Value.(type) {
			case string:
				if v == otelStatusCodeError {
					return true
				}
			case float64:
				// A JSON-decoded tag arrives as a number rather than a string.
				if int(v) == 2 {
					return true
				}
			}
		}
	}
	return false
}

// otelStatusCodeError is the OTLP status for a failed span, as VictoriaTraces
// stores it.
const otelStatusCodeError = "2"

// nodeGraphStats holds per-service aggregated stats for the node graph.
type nodeGraphStats struct {
	totalDuration int64
	spanCount     int64
	errorCount    int64
}

// edgeKey uniquely identifies a directed edge between two services.
type edgeKey struct {
	source, target string
}

// edgeGraphStats holds per-edge aggregated stats for the node graph.
type edgeGraphStats struct {
	totalDuration int64
	callCount     int64
	errorCount    int64
}

// TraceToNodeGraphFrames converts a slice of JaegerTraces into Grafana node-graph
// data frames (nodes + edges). Nodes are services, edges are calls between services.
// This provides the Tempo/Jaeger-like service dependency graph when viewing a trace.
func TraceToNodeGraphFrames(traces []JaegerTrace) (*data.Frame, *data.Frame) {
	services := make(map[string]*nodeGraphStats)
	edges := make(map[edgeKey]*edgeGraphStats)

	for _, trace := range traces {
		for _, span := range trace.Spans {
			process, ok := trace.Processes[span.ProcessID]
			if !ok {
				process = JaegerProcess{ServiceName: "unknown"}
			}
			svcName := process.ServiceName

			if _, exists := services[svcName]; !exists {
				services[svcName] = &nodeGraphStats{}
			}
			services[svcName].totalDuration += span.Duration
			services[svcName].spanCount++
			if spanHasError(span) {
				services[svcName].errorCount++
			}

			// Build edges from CHILD_OF references
			for _, ref := range span.References {
				if ref.RefType != "CHILD_OF" {
					continue
				}
				parentSvc := serviceForSpan(trace, ref.SpanID)
				if parentSvc == "" || parentSvc == svcName {
					continue
				}
				key := edgeKey{source: parentSvc, target: svcName}
				if _, exists := edges[key]; !exists {
					edges[key] = &edgeGraphStats{}
				}
				edges[key].callCount++
				edges[key].totalDuration += span.Duration
				if spanHasError(span) {
					edges[key].errorCount++
				}
			}
		}
	}

	// --- Nodes frame ---
	// Sort service names so frame ordering is deterministic across requests.
	svcNames := make([]string, 0, len(services))
	for svc := range services {
		svcNames = append(svcNames, svc)
	}
	sort.Strings(svcNames)

	nodeIDs := make([]string, 0, len(svcNames))
	nodeTitles := make([]string, 0, len(svcNames))
	nodeSubtitles := make([]string, 0, len(svcNames))
	nodeMainStats := make([]float64, 0, len(svcNames))
	nodeSecStats := make([]float64, 0, len(svcNames))
	nodeArcSuccess := make([]float64, 0, len(svcNames))
	nodeArcError := make([]float64, 0, len(svcNames))
	for _, svc := range svcNames {
		stats := services[svc]
		nodeIDs = append(nodeIDs, svc)
		nodeTitles = append(nodeTitles, svc)
		nodeSubtitles = append(nodeSubtitles, fmt.Sprintf("%d spans", stats.spanCount))
		if stats.spanCount > 0 {
			avgMs := float64(stats.totalDuration) / float64(stats.spanCount) / 1000.0
			nodeMainStats = append(nodeMainStats, avgMs)
		} else {
			nodeMainStats = append(nodeMainStats, 0)
		}
		nodeSecStats = append(nodeSecStats, float64(stats.spanCount))
		errRate := float64(0)
		if stats.spanCount > 0 {
			errRate = float64(stats.errorCount) / float64(stats.spanCount)
		}
		nodeArcSuccess = append(nodeArcSuccess, 1-errRate)
		nodeArcError = append(nodeArcError, errRate)
	}

	nodesFrame := data.NewFrame("nodes",
		data.NewField("id", nil, nodeIDs),
		data.NewField("title", nil, nodeTitles),
		data.NewField("subtitle", nil, nodeSubtitles),
		data.NewField("mainstat", nil, nodeMainStats).SetConfig(&data.FieldConfig{DisplayName: "Avg duration (ms)"}),
		data.NewField("secondarystat", nil, nodeSecStats).SetConfig(&data.FieldConfig{DisplayName: "Spans"}),
		data.NewField("arc__success", nil, nodeArcSuccess).SetConfig(&data.FieldConfig{DisplayName: "Success", Color: map[string]interface{}{"mode": "fixed", "fixedColor": "green"}}),
		data.NewField("arc__errors", nil, nodeArcError).SetConfig(&data.FieldConfig{DisplayName: "Errors", Color: map[string]interface{}{"mode": "fixed", "fixedColor": "red"}}),
	)
	nodesFrame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "nodeGraph",
		PreferredVisualizationPluginID: "victoriametrics-traces-nodegraph-panel",
	})

	// --- Edges frame ---
	edgeKeys := make([]edgeKey, 0, len(edges))
	for k := range edges {
		edgeKeys = append(edgeKeys, k)
	}
	sort.Slice(edgeKeys, func(i, j int) bool {
		if edgeKeys[i].source != edgeKeys[j].source {
			return edgeKeys[i].source < edgeKeys[j].source
		}
		return edgeKeys[i].target < edgeKeys[j].target
	})

	edgeIDs := make([]string, 0, len(edgeKeys))
	edgeSources := make([]string, 0, len(edgeKeys))
	edgeTargets := make([]string, 0, len(edgeKeys))
	edgeMainStats := make([]float64, 0, len(edgeKeys))
	edgeSecStats := make([]float64, 0, len(edgeKeys))
	for _, key := range edgeKeys {
		stats := edges[key]
		edgeIDs = append(edgeIDs, fmt.Sprintf("%s--%s", key.source, key.target))
		edgeSources = append(edgeSources, key.source)
		edgeTargets = append(edgeTargets, key.target)
		if stats.callCount > 0 {
			edgeMainStats = append(edgeMainStats, float64(stats.totalDuration)/float64(stats.callCount)/1000.0)
		} else {
			edgeMainStats = append(edgeMainStats, 0)
		}
		edgeSecStats = append(edgeSecStats, float64(stats.callCount))
	}

	edgesFrame := data.NewFrame("edges",
		data.NewField("id", nil, edgeIDs),
		data.NewField("source", nil, edgeSources),
		data.NewField("target", nil, edgeTargets),
		data.NewField("mainstat", nil, edgeMainStats).SetConfig(&data.FieldConfig{DisplayName: "Avg duration (ms)"}),
		data.NewField("secondarystat", nil, edgeSecStats).SetConfig(&data.FieldConfig{DisplayName: "Calls"}),
	)
	edgesFrame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "nodeGraph",
		PreferredVisualizationPluginID: "victoriametrics-traces-nodegraph-panel",
	})

	return nodesFrame, edgesFrame
}

// TraceChartsFrame is the marker frame for the charts panel.
//
// Explore groups custom frames by their panel id and gives each group its own
// container, so the charts get their own panel — and their own height — rather
// than sharing the trace list's. The charts fetch what they draw from the
// resource endpoints, so the frame carries no rows: only the datasource uid
// they need to make those calls.
func TraceChartsFrame(dsUID string) *data.Frame {
	frame := data.NewFrame("trace_charts")
	frame.SetMeta(&data.FrameMeta{
		PreferredVisualization:         "trace",
		PreferredVisualizationPluginID: "victoriametrics-traces-charts-panel",
		Custom:                         map[string]interface{}{"datasourceUid": dsUID},
	})
	return frame
}

// withQueryContext records the query a frame answers in its metadata.
//
// Explore builds a custom panel's data as {series, state, timeRange}: there is
// no request on it, so `data.request.targets` — where the panels used to read
// the services, filters and columns in force — is always undefined there. The
// frame is the only channel that survives, so the executed query travels on it.
func withQueryContext(frame *data.Frame, query json.RawMessage) {
	if frame == nil {
		return
	}
	if frame.Meta == nil {
		frame.Meta = &data.FrameMeta{}
	}
	custom, ok := frame.Meta.Custom.(map[string]interface{})
	if !ok {
		custom = map[string]interface{}{}
	}
	custom["query"] = query
	frame.Meta.Custom = custom
}
