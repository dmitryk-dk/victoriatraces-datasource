# VictoriaTraces datasource for Grafana

A Grafana datasource for [VictoriaTraces](https://docs.victoriametrics.com/victoriatraces/),
the tracing database from [VictoriaMetrics](https://victoriametrics.com/).

VictoriaTraces accepts traces over [OTLP](https://opentelemetry.io/docs/specs/otlp/) (both gRPC
and HTTP - see [data ingestion docs](https://docs.victoriametrics.com/victoriatraces/data-ingestion/#http-apis)).
On the read side it exposes a
[Jaeger-compatible HTTP API](https://docs.victoriametrics.com/victoriatraces/#querying-traces),
which is what this plugin talks to so you can search traces, drill into spans, and visualise
service dependencies side-by-side with logs and metrics.

A lot of the ideas (and a fair bit of the structure) come from the existing
[victoriametrics-datasource](https://github.com/VictoriaMetrics/victoriametrics-datasource) and
[victorialogs-datasource](https://github.com/VictoriaMetrics/victorialogs-datasource).

The plugin has been tested against the live VictoriaTraces playground at
<https://play-vtraces.victoriametrics.com/>. To exercise the cross-datasource correlations
(trace to metrics, trace to logs) it's also been wired up to the public VictoriaMetrics and
VictoriaLogs playgrounds:

- Metrics: <https://play.victoriametrics.com/>
- Logs: <https://play-vmlogs.victoriametrics.com/>

![VictoriaTraces in Grafana Explore - hero shot](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/hero-explore.png?raw=true)
<!-- Hero screenshot: Explore page with the VictoriaTraces datasource selected, showing a
     search result list or the waterfall view of a single trace. Aim for ~1600px wide,
     dark theme. Captures the overall look at a glance. -->

* [Features](#features)
* [Requirements](#requirements)
* [Quick start](#quick-start)
* [Installation](#installation)
  * [Manual install](#manual-install)
  * [Docker Compose](#docker-compose)
  * [Kubernetes](#kubernetes)
* [Grafana provisioning](#grafana-provisioning)
* [Usage](#usage)
* [Trace to Logs and to Metrics correlations](#trace--logs-and--metrics-correlations)
* [Development](#development)
* [Notes](#notes)
* [License](#license)

> **Heads up - this plugin is currently unsigned.**
> It isn't on the Grafana marketplace yet, so wherever Grafana runs it has to be told to load
> unsigned plugins. Every install section below covers that.

## Features

- Search traces by service, operation, tags, and time range (Jaeger-compatible API).
- Fetch a single trace by ID with a full waterfall span tree.
- Custom trace panel: service-coloured bars, error highlighting, span detail side panel.
- Custom node-graph panel: dagre-layout dependency graph with call-volume heat, click a service to filter Explore.
- LogsQL stats queries (`stats_query_range`, `stats_query`, `hits`) for time-series and stat panels.
- Trace-to-logs and trace-to-metrics correlations (configurable).
- Template variable support for service / operation / field names / field values.
- Auth: Basic, Bearer, custom headers, TLS client cert + custom CA, mTLS, HTTP proxy.
  All wired through Grafana's standard `DataSourceHttpSettings`.

## Requirements

- Grafana **12.3+** (the version `plugin.json` declares as `grafanaDependency`)
- [VictoriaTraces](https://docs.victoriametrics.com/victoriatraces/) **v0.8.0+**

Everything the plugin queries — the Jaeger read API, `/select/logsql/query`, the `stats_query`
and `hits` endpoints, `field_names` / `field_values`, and the live-tail stream — is served by
VictoriaTraces as far back as v0.5.0. The one exception is trace search, which uses the
Tempo-compatible `/select/tempo/api/search`; that endpoint arrives in **v0.8.0**. On an older
instance the datasource still connects and every other view works, and the search endpoint
reports the version it needs rather than failing anonymously.

## Quick start

Easiest way to kick the tyres: Docker Compose. Builds the plugin, brings up VictoriaTraces and
Grafana, auto-provisions the datasource and a sample dashboard.

```sh
make vt-plugin-build
docker compose up -d
```

Then open <http://localhost:3000> (login `admin` / `admin`) and head to **Explore**.

Send traces in via OTLP - gRPC on port `4317` or HTTP on port `10428`. See the
[ingestion section](#sending-traces-in) below for an OTel Collector example.

## Installation

### Manual install

This is the path you want if you're running Grafana directly on a host or VM.

**1. Build the plugin.**

```sh
git clone https://github.com/dmitryk-dk/victoriatraces-datasource.git
cd victoriatraces-datasource
make vt-plugin-build
```

This writes four plugin directories under `plugins/`:

- `victoriametrics-traces-datasource` - the datasource itself (Go backend + React frontend)
- `victoriametrics-traces-panel` - trace list and trace timeline panel
- `victoriametrics-traces-nodegraph-panel` - service dependency graph panel
- `victoriametrics-traces-charts-panel` - heatmap, scatter and operations charts

All four are needed. The datasource renders its results in the three panels, so a Grafana
that loads only the datasource shows an empty Explore page rather than an error.

Alternatively, grab a pre-built archive from the
[releases page](https://github.com/dmitryk-dk/victoriatraces-datasource/releases) and extract
it into Grafana's plugin directory.

**2. Run VictoriaTraces.**

```sh
docker run -d \
  --name victoriatraces \
  -p 10428:10428 \
  -p 4317:4317 \
  -v vtraces-data:/storage \
  victoriametrics/victoria-traces:latest \
  --storageDataPath=/storage \
  --retentionPeriod=7d \
  --otlpGRPCListenAddr=:4317
```

Useful flags:

| Flag | Default | What it does |
|------|---------|--------------|
| `-httpListenAddr` | `:10428` | HTTP API. Serves both the Jaeger query API (used by the plugin) and OTLP HTTP ingestion at `/insert/opentelemetry/v1/traces` |
| `-otlpGRPCListenAddr` | _disabled_ | OTLP gRPC ingestion. Usually `:4317` |
| `-storageDataPath` | `victoria-traces-data` | Where traces live on disk |
| `-retentionPeriod` | `7d` | How long traces are kept |

VictoriaTraces accepts traces via OTLP - full details in the
[data ingestion docs](https://docs.victoriametrics.com/victoriatraces/data-ingestion/).
The Jaeger API in VT is on the read side only; the plugin uses it to fetch traces, but you
can't send Jaeger spans in.

**3. Tell Grafana about the plugin.**

Edit `grafana.ini` (or `custom.ini` - anything that overrides defaults) so it loads the unsigned
plugin from where you built it:

```ini
[paths]
plugins = /absolute/path/to/victoriatraces-datasource/plugins

[plugins]
allow_loading_unsigned_plugins = victoriametrics-traces-datasource,victoriametrics-traces-panel,victoriametrics-traces-nodegraph-panel,victoriametrics-traces-charts-panel
```

All four IDs need to be in the allow list - the datasource won't work properly without the
three panel plugins.

**4. Start Grafana, then add the datasource.**

Go to 
1. Connections
2. Data sources
3. Add data source
4. VictoriaTraces
and set the URL to your VictoriaTraces instance (e.g. `http://localhost:10428`).

### Docker Compose

A `docker-compose.yml` in the repo brings up VictoriaTraces + Grafana with the plugin
pre-mounted and the datasource provisioned. Build first, then up:

```sh
make vt-plugin-build
docker compose up -d
```

The compose file sets `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` so the unsigned plugins load
on startup. Datasource and dashboards are provisioned from `provisioning/`.

### Kubernetes

Because the plugin is unsigned, you can't use `GF_INSTALL_PLUGINS` - that only works for plugins
on the Grafana catalog. Instead, download a release archive in an init container and tell
Grafana to allow it.

#### Grafana Helm chart

Pin a version and pull from the GitHub releases page:

<details>
<summary>values.yaml</summary>

```yaml
env:
  GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: "victoriametrics-traces-datasource,victoriametrics-traces-panel,victoriametrics-traces-nodegraph-panel,victoriametrics-traces-charts-panel"

extraInitContainers:
  - name: load-vt-ds-plugin
    image: curlimages/curl:8.10.1
    workingDir: /var/lib/grafana
    securityContext:
      runAsUser: 472
      runAsNonRoot: true
      runAsGroup: 472
    command: ["/bin/sh"]
    args:
      - "-c"
      - |
        set -ex
        mkdir -p /var/lib/grafana/plugins/
        ver=$(curl -s -L https://api.github.com/repos/dmitryk-dk/victoriatraces-datasource/releases/latest \
              | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        curl -L https://github.com/dmitryk-dk/victoriatraces-datasource/releases/download/$ver/victoriametrics-traces-datasource-${ver#v}.tar.gz \
             -o /tmp/vt-plugin.tar.gz
        tar -xf /tmp/vt-plugin.tar.gz -C /var/lib/grafana/plugins/
        rm /tmp/vt-plugin.tar.gz
    volumeMounts:
      # If you use grafana-operator, change `storage` to `grafana-data`.
      - name: storage
        mountPath: /var/lib/grafana
```
</details>

For `grafana-operator` users, drop the same init-container block under
`/spec/deployment/spec/template/spec/initContainers` on your `Grafana` resource.

If you're using the sidecar to load provisioned datasources, make sure it can see them:

```yaml
sidecar:
  datasources:
    enabled: true
    initDatasources: true
```

#### Grafana operator

Full example with `grafana-operator`:

<details>
<summary>deployment.yaml</summary>

```yaml
apiVersion: grafana.integreatly.org/v1beta1
kind: Grafana
metadata:
  name: grafana-vt
  labels:
    dashboards: grafana
spec:
  config:
    plugins:
      allow_loading_unsigned_plugins: "victoriametrics-traces-datasource,victoriametrics-traces-panel,victoriametrics-traces-nodegraph-panel,victoriametrics-traces-charts-panel"
  persistentVolumeClaim:
    spec:
      accessModes: [ReadWriteOnce]
      resources:
        requests:
          storage: 200Mi
  deployment:
    spec:
      template:
        spec:
          initContainers:
            - name: load-vt-ds-plugin
              image: curlimages/curl:8.10.1
              workingDir: /var/lib/grafana
              securityContext:
                runAsUser: 472
                runAsNonRoot: true
                runAsGroup: 472
              command: ["/bin/sh"]
              args:
                - "-c"
                - |
                  set -ex
                  mkdir -p /var/lib/grafana/plugins/
                  ver=$(curl -s -L https://api.github.com/repos/dmitryk-dk/victoriatraces-datasource/releases/latest \
                        | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
                  curl -L https://github.com/dmitryk-dk/victoriatraces-datasource/releases/download/$ver/victoriametrics-traces-datasource-${ver#v}.tar.gz \
                       -o /tmp/vt-plugin.tar.gz
                  tar -xf /tmp/vt-plugin.tar.gz -C /var/lib/grafana/plugins/
                  rm /tmp/vt-plugin.tar.gz
              volumeMounts:
                - name: grafana-data
                  mountPath: /var/lib/grafana
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: vt-datasource
spec:
  datasource:
    name: VictoriaTraces
    type: victoriametrics-traces-datasource
    access: proxy
    url: http://victoriatraces.observability.svc.cluster.local:10428
  instanceSelector:
    matchLabels:
      dashboards: grafana
```
</details>

A note on `GrafanaDatasource.spec.plugins`: that field expects a version published on the
Grafana catalog. We can't use it while the plugin is unsigned - the init container is the
workaround. Once a signed build is published this becomes a one-liner.

### Tarball install (any environment)

If you'd rather skip building, download a tarball straight into Grafana's plugin dir:

```sh
ver=$(curl -s -L https://api.github.com/repos/dmitryk-dk/victoriatraces-datasource/releases/latest \
      | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
curl -L https://github.com/dmitryk-dk/victoriatraces-datasource/releases/download/$ver/victoriametrics-traces-datasource-${ver#v}.tar.gz \
     -o /var/lib/grafana/plugins/vt-plugin.tar.gz
tar -xf /var/lib/grafana/plugins/vt-plugin.tar.gz -C /var/lib/grafana/plugins/
rm /var/lib/grafana/plugins/vt-plugin.tar.gz
```

Restart Grafana. Don't forget the `allow_loading_unsigned_plugins` entry.

## Grafana provisioning

The repo ships with example provisioning files used by the Docker Compose setup.

`provisioning/datasources/victoriatraces.yaml`:

```yaml
apiVersion: 1
datasources:
  - name: VictoriaTraces
    type: victoriametrics-traces-datasource
    access: proxy
    url: http://victoriatraces:10428
    isDefault: true
    editable: true
```

`provisioning/dashboards/dashboards.yaml`:

```yaml
apiVersion: 1
providers:
  - name: VictoriaTraces
    orgId: 1
    folder: VictoriaTraces
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

There's a starter dashboard at `provisioning/dashboards/victoriatraces-drilldown.json` - a good
starting point if you don't want to design one from scratch.

## Usage

1. Add a **VictoriaTraces** datasource and point it at your VT instance.

   ![Datasource configuration page](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/config-editor.png?raw=true)
   <!-- Datasource ConfigEditor: the form filled out with URL pointing at a VT instance,
        Node Graph toggle visible, Trace-to-Logs + Trace-to-Metrics panels expanded showing
        the linked VictoriaMetrics/VictoriaLogs datasources. Light or dark theme - pick one
        and use the same theme for all screenshots. -->

2. In **Explore**, pick a query type:
   - **Search** - by service / operation / tags / time range.

     ![Search query mode in Explore](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/query-editor-search.png?raw=true)
     <!-- QueryEditor in Search mode: Service select with a value picked, Operation select
          populated, one or two tag pills visible (e.g - http.status_code=500), Limit set.
          Show the dropdowns open if possible to make the autocomplete obvious. -->

   - **Trace ID** - for a known trace, jump straight to the waterfall.

     ![Waterfall span tree for a single trace](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/waterfall.png?raw=true)
     <!-- Trace detail view: the full waterfall, several services represented with
          different colours, at least one error span visible (red outline + ! badge),
          ideally with the span-detail side panel open showing tags/logs/links. -->

   - **LogsQL** - for `stats_query_range`, `stats_query`, raw logs, or `hits` queries.

     ![LogsQL query mode with Monaco editor and time series](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/query-editor-logsql.png?raw=true)
     <!-- QueryEditor in LogsQL mode: Monaco editor with a non-trivial expression
          (e.g. `* | stats by ("resource_attr:service.name") count() requests`), the Type
          radio (Raw Logs / Range / Instant) visible in the collapsible Options group,
          and the panel below rendering the result. -->

3. In a dashboard, drop the **VictoriaTraces panel** for the waterfall view, or the
   **VictoriaTraces node graph** panel for service dependencies.

   ![Service dependency graph panel](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/docs/screenshots/node-graph.png?raw=true)
   <!-- DependencyGraph panel: at least 4-5 services laid out vertically (dagre TB),
        coloured edges with call counts, ideally one node clicked so the highlight +
        dim state is visible. The Calls low to high legend should be in shot. -->

### Sending traces in

Ingestion is via OTLP - gRPC on `4317` or HTTP on `10428` at
`/insert/opentelemetry/v1/traces`. Any OTLP-compatible client works; the OpenTelemetry Collector
is the quickest path:

```yaml
# OTLP gRPC
exporters:
  otlp:
    endpoint: victoriatraces:4317
    tls:
      insecure: true
```

```yaml
# OTLP HTTP
exporters:
  otlphttp:
    endpoint: http://victoriatraces:10428/insert/opentelemetry/v1/traces
```

If your apps push to Jaeger or Zipkin today, run them through an OTel Collector with the
matching receiver - the collector translates to OTLP and forwards on. Full details in the
[data ingestion docs](https://docs.victoriametrics.com/victoriatraces/data-ingestion/).

### Template variables

Two variable types:

- **Field names** - every field name available, optionally narrowed by a LogsQL filter.
- **Field values** - values for a chosen field, with a configurable limit.

## Trace to Logs and to Metrics correlations

In the span detail side panel you'll see a **Logs** button and (when configured) one or more
**Metrics** buttons. Clicking either opens an Explore split pane with a query that filters to the
context of the span you clicked.

### Trace to Logs

Works out of the box when your logs are OTel-ingested into VictoriaLogs.

1. In the VictoriaTraces datasource config, scroll to **Trace to Logs** and pick the
   **VictoriaLogs** datasource.
2. That's it - save and try a trace.

What runs under the hood:

```
trace_id:=<traceId from span> AND "service.name":=<service from span>
```

OTel-flavoured VictoriaLogs ingestion lands trace ID under `trace_id`, span ID under `span_id`,
and resource attribute `service.name` under the dotted field name `"service.name"` - those
defaults match. If your pipeline stores things differently (custom log shipper, non-OTel
collector), edit the **Query** field in the config and use the placeholders below.

#### Query placeholders

| Placeholder | Value |
|---|---|
| `${__span.traceId}` | Trace ID for the clicked span |
| `${__span.spanId}` | The clicked span's ID |
| `${__span.service}` | Service name resolved from the span's process |
| `${__span.operation}` | Span operation name |
| `${__span.tags.X}` | Value of span tag `X` (e.g. `${__span.tags.http.status_code}`) |

Example overrides:

```
# Use a custom log shipper that stores trace ID under `tracing.trace_id`
"tracing.trace_id":=${__span.traceId}

# Show logs only for the clicked span (ignore other spans in the same trace)
span_id:=${__span.spanId}

# Trace + service + HTTP status code
trace_id:=${__span.traceId} AND "service.name":=${__span.service} AND "http.status_code":=${__span.tags.http.status_code}
```

### Trace to Metrics

This is where setup matters. Unlike logs, **there's no universal metric schema** - the metric
names and label names depend entirely on how your applications expose metrics and how
VictoriaMetrics scrapes them. The plugin doesn't ship default queries because a default that
matches nothing is worse than no button at all.

#### Step 1: confirm you have the right metrics

Before configuring the plugin, open Explore in your VictoriaMetrics datasource and run:

```promql
{service="<your-service-name>"}
```

If nothing comes back, try:

```promql
{job="<your-service-name>"}
{app="<your-service-name>"}
{service_name="<your-service-name>"}
```

Whichever label returns data is the one you'll reference in your query template.

If **nothing** returns data for any of those labels, your apps don't currently expose metrics
tagged with the service. The two common ways to fix that:

1. **Run the OpenTelemetry Collector `spanmetrics` connector.** It watches incoming spans and
   emits Prometheus metrics named `traces_spanmetrics_calls_total`,
   `traces_spanmetrics_duration_seconds_*` with `service_name` / `span_name` / `status_code`
   labels. Export to VictoriaMetrics via the Prometheus remote write or the OTLP HTTP
   endpoint. See the [OTel spanmetrics docs](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/spanmetricsconnector).
2. **Add a service label to your existing scrape config.** In your `prometheus.yml` /
   `vmagent` scrape job, set:
   ```yaml
   relabel_configs:
     - target_label: service
       replacement: my-service-name
   ```

#### Step 2: pick the datasource

In the VictoriaTraces datasource config, scroll to **Trace to Metrics** and pick the
**VictoriaMetrics** datasource. Two ways to drive what runs from there - pick one, or use both.

#### Step 3a: Label mappings (auto-built selector - recommended for "just show me this service's metrics")

Each row maps a **span field** to the corresponding **metric label**. The plugin combines them
into a MetricsQL selector `{label="value", ...}` and renders a single **Metrics** button.

Example mapping:

| Span field | Metric label |
|---|---|
| `service` | `service` |
| `trace_id` | `trace_id` |

Click a span belonging to `frontend-proxy` with trace ID `abc123` to button opens VM Explore with:
```
{service="frontend-proxy", trace_id="abc123"}
```

What you can put in the **Span field** column:

| Span field | Resolves to |
|---|---|
| `service`, `service.name`, `service_name` | Process service name (regex-matched, all variants work) |
| `trace_id`, `traceID`, `trace.id` | Span's trace ID |
| `span_id`, `spanID`, `span.id` | Span's ID |
| `operation`, `operation.name`, `operationName` | Span operation name |
| `tags.<key>` (e.g. `tags.http.method`) | A specific span tag value |
| Any tag key directly (e.g. `http.status_code`) | Span tag to process tag (resource attribute) fallback |

Values are MetricsQL-escaped (backslashes, quotes, newlines, tabs) so tag values with
special characters don't break the query.

#### Step 3b: Named queries (advanced - for RED-style multi-button setups)

Each row in the **Named queries** list becomes its own button. The `Name` is the button label,
the `Query` is a MetricsQL template with `${__span.X}` placeholders.

> When **Named queries** has any rows, **Label mappings** are ignored - named queries fully
> control the buttons.

Common RED-style setup if you have spanmetrics:

| Name | Query |
|---|---|
| `Rate` | `rate(traces_spanmetrics_calls_total{service_name="${__span.service}"}[$__rate_interval])` |
| `Errors` | `rate(traces_spanmetrics_calls_total{service_name="${__span.service}", status_code="STATUS_CODE_ERROR"}[$__rate_interval])` |
| `Duration p90` | `histogram_quantile(0.9, sum(rate(traces_spanmetrics_duration_seconds_bucket{service_name="${__span.service}"}[$__rate_interval])) by (le))` |

Application-instrumented metrics (no spanmetrics):

| Name | Query |
|---|---|
| `Request rate` | `rate(http_server_requests_total{service="${__span.service}"}[$__rate_interval])` |
| `Error rate` | `rate(http_server_requests_total{service="${__span.service}", status=~"5.."}[$__rate_interval])` |
| `p95 latency` | `histogram_quantile(0.95, rate(http_server_request_duration_seconds_bucket{service="${__span.service}"}[$__rate_interval]))` |

Same placeholders as Trace to Logs. Standard Grafana template variables (`$__rate_interval`, `$__range`) pass through to VictoriaMetrics.

#### Step 4: use it

Open a trace, click any span. The side panel shows:

- **Logs** button (if Trace-to-Logs is configured)
- One **Metrics** button (when only Label mappings are set), or
- One button per **Named query** (when any are set)

Click any button to Explore split pane opens with VictoriaLogs / VictoriaMetrics pre-filled
with the substituted query. The time range comes from your current dashboard / Explore window.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Logs button returns 0 rows | Your logs use a different field for service or trace ID | Edit the **Trace to Logs Query** field with the correct field name |
| Metrics button returns 0 series | Label mismatch. `service` vs `service_name` vs `job` | Confirm the right label by running `{label="..."}` in VM Explore, then update the **Label mappings** rows (or the **Named query** template) |
| Metrics buttons not visible | No mappings and no named queries configured | Add a row in **Trace to Metrics to Label mappings**, or one in **Named queries** |
| Auto-built selector is empty / button does nothing | Configured span field has no value on this span | Try a different mapping (e.g. `service` if the span has no `trace_id`), or click a different span |
| Both buttons grey / disabled | Linked datasource was deleted | Re-pick the datasource in the VictoriaTraces config |
| Query opens but pane shows old data | Refresh the right pane manually | This was an old bug - make sure you're on the latest build |
| "Logs" works but "Metrics" doesn't (or vice versa) | Only one datasource is configured | Both pickers are independent - set whichever you need, leave the other empty |

## Development

### 1. Install Grafana

[Download Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/installation/), 12.3 or newer.

<details>
<summary>Tip for Apple Silicon</summary>

The Grafana download page defaults to amd64 - swap `amd64` for `arm64` in the URL if you're on
an M-series Mac.
[More on debugging plugins on Apple Silicon.](https://st-g.de/2023/10/grafana-plugin-debugging-on-apple-silicon)

</details>

### 2. Allow the unsigned plugin

```ini
[paths]
plugins = /path/to/victoriatraces-datasource/plugins

[plugins]
allow_loading_unsigned_plugins = victoriametrics-traces-datasource,victoriametrics-traces-panel,victoriametrics-traces-nodegraph-panel,victoriametrics-traces-charts-panel
```

### 3. Run it

Frontend, in watch mode:

```sh
npm ci
npm run dev
```

Backend:

```sh
go install github.com/magefile/mage@v1.15.0
go mod download
mage -v
```

Or just build both at once:

```sh
make vt-plugin-build
```

### Tests

```sh
make golang-test          # Go unit tests
make golang-test-race     # race detector
npm test                  # TypeScript unit tests
```

### Building a release archive locally

```sh
make vt-plugin-release PKG_TAG=v1.0.0
```

Output ends up in `release/` as zip + tarball + SHA1 checksums.

### Debugging the backend

Same flow as VictoriaLogs: install `delve`, run `mage debugger`, attach your IDE to port 3222.

## Notes

`plugin.json` has `metrics: true`. That doesn't mean VictoriaTraces serves metrics - it just lets
the plugin be picked up in the panel editor for LogsQL stats queries that return numeric series.

The bundled panel plugins (`victoriametrics-traces-panel`,
`victoriametrics-traces-nodegraph-panel`, `victoriametrics-traces-charts-panel`) ship together
with the datasource in the same release archive. They share styling and a few utilities, and they expect the datasource to
emit specific data-frame shapes - using them with another datasource won't do anything useful.

If you hit a 404 from `GET /select/jaeger/api/traces/<id>` that's the upstream telling you the
trace either expired (retention) or never made it in. The plugin surfaces that as a clean
"trace not found" message rather than the raw Jaeger JSON.

For more on `plugin.json` fields, see the
[Grafana plugin reference](https://grafana.com/developers/plugin-tools/reference-plugin-json#properties).

## License

Apache-2.0 - see [LICENSE](https://github.com/dmitryk-dk/victoriatraces-datasource/blob/main/LICENSE).
