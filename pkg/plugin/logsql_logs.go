package plugin

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/valyala/fastjson"
)

const (
	// NDJSON field names used by VictoriaLogs / VictoriaTraces.
	fieldMsg    = "_msg"
	fieldStream = "_stream"
	fieldTime   = "_time"

	// Grafana data-frame field names for logs visualisation.
	gfLabels = "labels"
	gfTime   = "Time"
	gfLine   = "Line"

	defaultLogsLimit = 1000
)

// parseLogsResponse reads an NDJSON response from /select/logsql/query and
// returns a Grafana DataResponse with a single logs frame.
// Mirrors VictoriaLogs' parseInstantResponse.
func parseLogsResponse(reader io.Reader) backend.DataResponse {
	labelsField := data.NewFieldFromFieldType(data.FieldTypeJSON, 0)
	labelsField.Name = gfLabels

	timeField := data.NewFieldFromFieldType(data.FieldTypeTime, 0)
	timeField.Name = gfTime

	lineField := data.NewFieldFromFieldType(data.FieldTypeString, 0)
	lineField.Name = gfLine

	br := bufio.NewReaderSize(reader, 64*1024)
	var parser fastjson.Parser
	var (
		// When a line exceeds the bufio buffer we keep reading until the
		// newline; the line is discarded but never partially processed.
		skipUntilNewline bool
		now              = time.Now()
	)

	for n := 0; ; n++ {
		b, err := br.ReadBytes('\n')
		if err != nil {
			switch {
			case errors.Is(err, bufio.ErrBufferFull):
				skipUntilNewline = true
				continue
			case errors.Is(err, io.EOF):
				// Process whatever was returned with EOF, then stop.
			default:
				return newResponseError(fmt.Errorf("reading response line: %w", err), backend.StatusInternal)
			}
		}
		if skipUntilNewline {
			skipUntilNewline = false
			backend.Logger.Debug("skipping line: too long", "lineNumber", n)
			if errors.Is(err, io.EOF) {
				break
			}
			continue
		}

		b = bytes.TrimRight(b, "\n")
		if len(b) == 0 {
			if errors.Is(err, io.EOF) {
				break
			}
			continue
		}

		value, parseErr := parser.ParseBytes(b)
		if parseErr != nil {
			return newResponseError(fmt.Errorf("decoding response line: %w", parseErr), backend.StatusInternal)
		}

		// Parse all three required fields up front so we can append in lockstep.
		line := ""
		hasMsg := value.Exists(fieldMsg)
		if hasMsg {
			line = string(value.GetStringBytes(fieldMsg))
		}

		ts := now
		if value.Exists(fieldTime) {
			t, tErr := parseLogsTime(string(value.GetStringBytes(fieldTime)))
			if tErr != nil {
				return newResponseError(fmt.Errorf("parsing _time field: %w", tErr), backend.StatusInternal)
			}
			ts = t
		}

		labels := data.Labels{}
		if value.Exists(fieldStream) {
			fields, sErr := parseStreamFields(string(value.GetStringBytes(fieldStream)))
			if sErr != nil {
				return newResponseError(fmt.Errorf("parsing _stream field: %w", sErr), backend.StatusInternal)
			}
			for _, f := range fields {
				labels[f.label] = f.value
			}
		}

		obj, objErr := value.Object()
		if objErr != nil {
			return newResponseError(fmt.Errorf("reading response object: %w", objErr), backend.StatusInternal)
		}
		obj.Visit(func(key []byte, v *fastjson.Value) {
			k := string(key)
			if k == fieldTime || k == fieldStream || k == fieldMsg {
				return
			}
			labels[k] = string(v.GetStringBytes())
		})

		// Fallback line: render labels JSON when _msg is missing so the row
		// still shows something meaningful in the Logs panel.
		lb, mErr := json.Marshal(labels)
		if mErr != nil {
			return newResponseError(fmt.Errorf("marshalling labels: %w", mErr), backend.StatusInternal)
		}
		if !hasMsg {
			line = string(lb)
		}

		timeField.Append(ts)
		lineField.Append(line)
		labelsField.Append(json.RawMessage(lb))

		if errors.Is(err, io.EOF) {
			break
		}
	}

	frame := data.NewFrame("", timeField, lineField, labelsField)
	frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeLogs}

	return backend.DataResponse{Frames: data.Frames{frame}}
}

// newResponseError wraps an error into a DataResponse with the given status.
func newResponseError(err error, status backend.Status) backend.DataResponse {
	return backend.ErrDataResponse(status, err.Error())
}

// parseLogsTime parses the _time field from an NDJSON log record.
// VictoriaTraces emits RFC3339 with nanosecond precision; falls back to
// a plain Unix float (seconds) for older formats.
// Mirrors VictoriaLogs' utils.GetTime.
func parseLogsTime(s string) (time.Time, error) {
	// RFC3339 with or without sub-second precision
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC(), nil
	}
	// Plain Unix timestamp in seconds (float)
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		sec := int64(f)
		nsec := int64((f - float64(sec)) * 1e9)
		return time.Unix(sec, nsec).UTC(), nil
	}
	return time.Time{}, fmt.Errorf("cannot parse time %q", s)
}

// streamField holds a single label=value pair from a _stream value.
type streamField struct {
	label string
	value string
}

// parseStreamFields parses VictoriaLogs' _stream format: {label="value",...}
// Mirrors VictoriaLogs' utils.ParseStreamFields.
func parseStreamFields(s string) ([]streamField, error) {
	if s == "" {
		return nil, nil
	}
	if !strings.HasPrefix(s, "{") || !strings.HasSuffix(s, "}") {
		return nil, fmt.Errorf("_stream must be wrapped in {}: %q", s)
	}
	inner := s[1 : len(s)-1]
	if inner == "" {
		return nil, nil
	}

	pairs := splitStreamPairs(inner)
	fields := make([]streamField, 0, len(pairs))
	for _, pair := range pairs {
		pair = strings.TrimSpace(pair)
		eqIdx := strings.IndexByte(pair, '=')
		if eqIdx < 0 {
			return nil, fmt.Errorf("invalid _stream pair %q: missing '='", pair)
		}
		label := strings.TrimSpace(pair[:eqIdx])
		rawVal := strings.TrimSpace(pair[eqIdx+1:])
		val, err := strconv.Unquote(rawVal)
		if err != nil {
			return nil, fmt.Errorf("invalid _stream value %q: %w", rawVal, err)
		}
		if label == "" || val == "" {
			return nil, fmt.Errorf("empty label or value in _stream pair %q", pair)
		}
		fields = append(fields, streamField{label: label, value: val})
	}
	return fields, nil
}

// splitStreamPairs splits `label="value",label2="value2"` on the commas that
// separate pairs, respecting quoted values.
func splitStreamPairs(s string) []string {
	var pairs []string
	var cur strings.Builder
	inQuotes := false
	escaping := false

	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case escaping:
			cur.WriteByte(ch)
			escaping = false
		case ch == '\\' && inQuotes:
			cur.WriteByte(ch)
			escaping = true
		case ch == '"':
			inQuotes = !inQuotes
			cur.WriteByte(ch)
		case ch == ',' && !inQuotes:
			pairs = append(pairs, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(ch)
		}
	}
	if cur.Len() > 0 {
		pairs = append(pairs, cur.String())
	}
	return pairs
}

// parseHitsResponse parses the JSON response from /select/logsql/hits
// and returns a DataResponse with one frame per hit group.
// Mirrors VictoriaLogs' parseHitsResponse.
func parseHitsResponse(reader io.Reader) backend.DataResponse {
	var hr HitsResponse
	if err := json.NewDecoder(reader).Decode(&hr); err != nil {
		return newResponseError(fmt.Errorf("failed to decode hits response: %w", err), backend.StatusInternal)
	}

	frames := make(data.Frames, 0, len(hr.Hits))
	for _, hit := range hr.Hits {
		if len(hit.Timestamps) != len(hit.Values) {
			return newResponseError(
				fmt.Errorf("timestamps and values length mismatch: %d != %d", len(hit.Timestamps), len(hit.Values)),
				backend.StatusInternal,
			)
		}

		timeFd := data.NewFieldFromFieldType(data.FieldTypeTime, len(hit.Timestamps))
		timeFd.Name = gfTime

		valueFd := data.NewFieldFromFieldType(data.FieldTypeFloat64, len(hit.Values))
		valueFd.Name = "Value"
		valueFd.Labels = make(data.Labels)

		for j, ts := range hit.Timestamps {
			t, err := parseLogsTime(ts)
			if err != nil {
				return newResponseError(fmt.Errorf("error parse time from hits: %s", err), backend.StatusInternal)
			}
			timeFd.Set(j, t)
		}

		for k, v := range hit.Values {
			valueFd.Set(k, v)
		}

		for key, value := range hit.Fields {
			valueFd.Labels[key] = value
		}
		if len(valueFd.Labels) > 0 {
			lb, err := json.Marshal(valueFd.Labels)
			if err != nil {
				return newResponseError(fmt.Errorf("converting labels to json: %w", err), backend.StatusInternal)
			}
			valueFd.Config = &data.FieldConfig{DisplayNameFromDS: string(lb)}
		}

		frames = append(frames, data.NewFrame("", timeFd, valueFd))
	}

	return backend.DataResponse{Frames: frames}
}
