package plugin

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/valyala/fastjson"
)

// isPermanentTailError reports whether an error from QueryLogsQLTail is
// guaranteed to recur if the same query is retried. /select/logsql/tail
// returns 400 for unsupported expressions (pipes, aggregations, etc.) and
// 404 if the upstream path is unknown — both are permanent for this query.
func isPermanentTailError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.Status == http.StatusBadRequest || apiErr.Status == http.StatusNotFound
}

// buildTailNoticeFrame produces an empty logs frame whose only purpose is
// to carry an error notice up to the Grafana panel/Explore. We return it
// from RunStream as a one-shot before returning nil so the user sees the
// upstream message instead of a silent failure.
func buildTailNoticeFrame(msg string) *data.Frame {
	timeFd := data.NewFieldFromFieldType(data.FieldTypeTime, 0)
	timeFd.Name = gfTime
	lineFd := data.NewFieldFromFieldType(data.FieldTypeString, 0)
	lineFd.Name = gfLine
	labelsFd := data.NewFieldFromFieldType(data.FieldTypeJSON, 0)
	labelsFd.Name = gfLabels

	frame := data.NewFrame("", timeFd, lineFd, labelsFd)
	frame.Meta = &data.FrameMeta{
		PreferredVisualization: data.VisTypeLogs,
		Notices: []data.Notice{{
			Severity: data.NoticeSeverityError,
			Text:     msg,
		}},
	}
	return frame
}

// parseTailStream reads NDJSON lines from a /select/logsql/tail response and
// emits one Grafana logs frame per line into ch. It returns when the reader
// closes, the context is cancelled, or a fatal parse error is hit.
//
// Each frame has the same shape (Time, Line, labels) as the batch logs
// parser so the Logs panel can render incremental rows without rebuilding
// the schema. Long lines that exceed the bufio buffer are skipped with a
// debug log — same behavior as the VictoriaLogs datasource.
func parseTailStream(ctx context.Context, reader io.Reader, ch chan<- *data.Frame) error {
	br := bufio.NewReaderSize(reader, 64*1024)
	var parser fastjson.Parser

	for n := 0; ; n++ {
		if err := ctx.Err(); err != nil {
			return nil
		}

		b, err := br.ReadBytes('\n')
		switch {
		case errors.Is(err, bufio.ErrBufferFull):
			backend.Logger.Debug("skipping tail line: too long", "lineNumber", n)
			continue
		case errors.Is(err, io.EOF):
			if len(b) == 0 {
				return nil
			}
			// Fall through and process the trailing fragment, then exit.
		case err != nil:
			return fmt.Errorf("reading tail line: %w", err)
		}

		b = bytes.TrimRight(b, "\n")
		if len(b) == 0 {
			if errors.Is(err, io.EOF) {
				return nil
			}
			continue
		}

		value, parseErr := parser.ParseBytes(b)
		if parseErr != nil {
			backend.Logger.Warn("decoding tail line", "error", parseErr)
			if errors.Is(err, io.EOF) {
				return nil
			}
			continue
		}

		frame, fErr := tailLineToFrame(value)
		if fErr != nil {
			backend.Logger.Warn("building tail frame", "error", fErr)
			if errors.Is(err, io.EOF) {
				return nil
			}
			continue
		}

		select {
		case <-ctx.Done():
			return nil
		case ch <- frame:
		}

		if errors.Is(err, io.EOF) {
			return nil
		}
	}
}

// tailLineToFrame converts a single decoded NDJSON value into a logs frame
// with one row. Shape matches parseLogsResponse so the Logs panel can
// concatenate batch + streaming results.
func tailLineToFrame(value *fastjson.Value) (*data.Frame, error) {
	timeFd := data.NewFieldFromFieldType(data.FieldTypeTime, 0)
	timeFd.Name = gfTime
	lineFd := data.NewFieldFromFieldType(data.FieldTypeString, 0)
	lineFd.Name = gfLine
	labelsFd := data.NewFieldFromFieldType(data.FieldTypeJSON, 0)
	labelsFd.Name = gfLabels

	hasMsg := value.Exists(fieldMsg)
	line := ""
	if hasMsg {
		line = string(value.GetStringBytes(fieldMsg))
	}

	ts := time.Now()
	if value.Exists(fieldTime) {
		t, err := parseLogsTime(string(value.GetStringBytes(fieldTime)))
		if err != nil {
			return nil, fmt.Errorf("parsing _time: %w", err)
		}
		ts = t
	}

	labels := data.Labels{}
	if value.Exists(fieldStream) {
		fields, err := parseStreamFields(string(value.GetStringBytes(fieldStream)))
		if err != nil {
			return nil, fmt.Errorf("parsing _stream: %w", err)
		}
		for _, f := range fields {
			labels[f.label] = f.value
		}
	}

	obj, err := value.Object()
	if err != nil {
		return nil, fmt.Errorf("reading object: %w", err)
	}
	obj.Visit(func(key []byte, v *fastjson.Value) {
		k := string(key)
		if k == fieldTime || k == fieldStream || k == fieldMsg {
			return
		}
		labels[k] = string(v.GetStringBytes())
	})

	lb, err := json.Marshal(labels)
	if err != nil {
		return nil, fmt.Errorf("marshalling labels: %w", err)
	}
	if !hasMsg {
		line = string(lb)
	}

	timeFd.Append(ts)
	lineFd.Append(line)
	labelsFd.Append(json.RawMessage(lb))

	frame := data.NewFrame("", timeFd, lineFd, labelsFd)
	frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeLogs}
	return frame, nil
}
