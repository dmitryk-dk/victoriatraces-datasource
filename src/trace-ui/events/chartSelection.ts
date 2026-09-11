import { BusEventWithPayload } from '@grafana/data';

import type { ChartSelection } from '../components/heatmapGrid';

interface Payload {
  /** The window drawn on a chart, or null when it was cleared. */
  selection: ChartSelection | null;
}

/**
 * A window drawn on the heatmap or the scatter plot.
 *
 * The charts and the trace list are separate panels — Explore gives each
 * custom panel its own container, and its own height — so the selection
 * travels between them on Grafana's event bus, which both panels share within
 * a pane (and within a dashboard). Panel state is private, and putting a
 * half-drawn box in the URL would re-run the whole query on every drag.
 */
export class TraceChartSelectionEvent extends BusEventWithPayload<Payload> {
  static readonly type = 'victoriatraces-chart-selection';
}
