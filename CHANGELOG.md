# Changelog

All notable changes to the VictoriaTraces datasource plugin for Grafana are
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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