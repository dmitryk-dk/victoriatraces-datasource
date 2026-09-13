# Changelog

All notable changes to the VictoriaTraces datasource plugin for Grafana are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** the plugin is now packaged as a Grafana app plugin
  (`victoriametrics-traces-app`) with the datasource and both panels nested inside it.
  A single directory is installed instead of three.
- **Breaking:** plugin IDs now follow Grafana's `<orgId>-<name>-<type>` convention:
  - `victoriatraces-datasource` -> `victoriametrics-traces-datasource`
  - `victoriatraces-panel` -> `victoriametrics-traces-panel`
  - `victoriatraces-panel-graph` -> `victoriametrics-traces-nodegraph-panel`
- **Breaking:** minimum supported Grafana is now 12.3.0, required by React 19.
- Release archives are named after the app plugin id.

### Added

- App plugin with a **Traces** nav entry, carrying the datasource picker, time range and
  shareable URL state.
- Tempo API support: trace search now goes through `/select/tempo/api/search`, which returns
  trace summaries instead of whole traces. Trace-by-ID stays on the Jaeger API, which is the
  only one VictoriaTraces implements for it.
- New datasource resources: `search`, `trace/<id>` and `dependencies`.
- Trace data layer for the app page built on RxJS over `getBackendSrv()`, with request
  caching, in-flight deduplication and cursor-based paging.
- Spans mode: a Traces/Spans toggle switches the list between whole traces and individual
  spans, swapping the per-trace aggregate columns for the span's own ID, kind and status.
  Filters apply to the spans themselves in this mode rather than selecting the traces that
  contain them.
- Trace list on the app page: columns for trace ID, service/operation, start time, duration,
  span count and error count, with in-cell bars, service chips that collapse to "+N",
  client-side text filtering and infinite scroll. Rows arrive newest first.
- Trace preview panel: duration distribution against comparable traces, the span owning the
  largest share of the critical path, per-service self-time breakdown, a chronological error
  timeline, and the root span's attributes grouped by origin.
- Trace-to-logs and trace-to-metrics actions in the preview panel, opening the correlated
  query in Explore's companion pane. The correlation logic is now shared with the span
  detail panel instead of living only inside it.
- Trace waterfall: critical-path overlay marking the segments that gated the trace's
  duration, toggleable from the header.
- Span table view: a flat, sortable alternative to the waterfall for finding the slowest or
  failing spans. The choice is remembered per browser.
- Filter bar: service picker, plus operation, tag, duration, error-only, span-count, span-type
  and limit filters as removable badges, with a free-form LogsQL box. Filters, services, the
  query and the time range all live in the URL, so a view can be shared as a link.
- Charts above the trace list: duration/time heatmap, duration scatter plot, per-service
  operations breakdown, and a service dependency map, switchable and each querying only while
  visible.
- Faceted filter sidebar: Service and Operation values present in the range with the number of
  traces carrying each, plus span type and errors-only, and Traces/Spans tabs. Backed by a new
  `facets` datasource resource.
- Generic field filter — exists, equals, not equals, contains, has prefix, has suffix,
  regexp — in Field, Custom and All modes, each serialized to LogsQL.
- Heatmap chrome: time axis, a clickable Errors/OK legend that isolates one kind, and a
  density scale showing the busiest cell. Charts are tabs and can be collapsed.
- Trace preview header: trace ID, root service and operation, span count, and a full-width
  link to the trace view. The slowest service is tagged LONGEST.
- Drill from a chart into the list: clicking a heatmap duration band adds a duration filter,
  and clicking an operation row adds an operation filter. Both go through the query, so the
  charts, the list and the URL stay in agreement.
- New `operation_stats` datasource resource: span counts, average duration and error counts
  per operation for one service.
- Trace list column controls: show or hide columns (remembered per browser), drag to resize,
  and copy a trace ID from its row.
- Custom attribute columns: add any span field as a list column. Values are read from the
  root span, so a column describes the trace rather than an arbitrary span inside it.
- New datasource resources `trace_list`, `operation_durations` and `heatmap`, all LogsQL
  aggregations. The trace list cannot come from the Tempo search endpoint: that returns five
  fields per trace, and the list needs span counts, error counts and the full service set.

### Fixed

- Trace waterfall: sibling spans are ordered by start time, so an async parent's children
  interleave as they actually ran instead of appearing grouped by service.
- Trace waterfall: a span whose parent is missing from the trace is now treated as a root and
  rendered, instead of disappearing from partial traces.
- Docker Compose: VictoriaTraces 0.8.2 defaults `-otlpGRPC.tls` to true and then refuses to
  start without a key file, so the dev stack now passes `--otlpGRPC.tls=false`.

## [1.0.0] - 2026-06-06

### Added

**Querying**
- Search traces by service, operation, tags, and time range (Jaeger-compatible).
- Trace-by-ID lookup with full waterfall span tree.
- LogsQL query types: `logsql` (range), `logsql-instant`, `logsql-logs` (raw),
  and `logsql-hits` (grouped counts).
- Service-scoped autocomplete for tag keys and values via the LogsQL
  `field_names` / `field_values` endpoints.
- Template-variable support: `$__interval`, `$__interval_ms`, `$__range`,
  plus a custom `VariableSupport` provider for service / operation / field
  values.

**Visualisation**
- Custom trace panel: collapsible span tree, service-coloured waterfall bars,
  outside-label fallback for narrow spans, error spans marked with red
  outline + diagonal stripes + `!` badge.
- Custom node-graph panel: dagre-layout dependency view, edge-call heat
  gradient, clickable nodes that filter Explore by service, 1-hop neighbour
  highlight, legend chip explaining the heat colours.
- Trace search results: scatter plot + table toggle.
- Span detail side panel with tags, logs, references, and copy-to-clipboard
  helpers.

**Correlations**
- Trace-to-logs linking with configurable trace/span filters and forwarded tags.
- Trace-to-metrics linking with configurable forwarded tags.
- Derived fields for extracting clickable links from log lines.

**Backend**
- Go backend with full Grafana plugin SDK integration.
- Honours all `DataSourceHttpSettings` from the ConfigEditor: Basic Auth,
  Bearer token, custom headers, TLS client cert + custom CA + skip-verify,
  HTTP proxy, configurable timeout.
- Typed `APIError` for non-2xx responses, with friendly handling of
  "trace not found" 404s.
- Deterministic ordering of node-graph nodes and edges.
- NDJSON streaming of LogsQL log responses with bounded buffer.

**Datasource health**
- `CheckHealth` pings the services endpoint to verify connectivity.

**Tooling**
- GitHub Actions CI: split frontend / backend workflows with `paths:` filters,
  matrix tests, parallel race detection, build artifact upload.
- CodeQL security scans for Go and TypeScript on PR + weekly cron.
- OSV vulnerability scan gating the release workflow.
- Apache-2.0 licensed.

[Unreleased]: https://github.com/dmitryk-dk/victoriatraces-datasource/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dmitryk-dk/victoriatraces-datasource/releases/tag/v1.0.0
