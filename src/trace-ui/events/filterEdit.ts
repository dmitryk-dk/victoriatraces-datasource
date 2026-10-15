import { BusEventWithPayload } from '@grafana/data';

import type { TraceFilter } from '../filters/types';

interface Payload {
  /** Filters to add. */
  added: TraceFilter[];
  /** Kinds the added filters replace. */
  replaceKinds: Array<TraceFilter['kind']>;
}

/**
 * A drill from the charts panel, on a dashboard.
 *
 * In Explore a drill rewrites the query in the URL and every panel follows.
 * Dashboard panels each run their own saved query and none can rewrite the
 * URL, so the charts panel announces the drill here and the trace list applies
 * it to its own query.
 */
export class TraceFilterEditEvent extends BusEventWithPayload<Payload> {
  static readonly type = 'victoriatraces-filter-edit';
}
