import { EventBusSrv } from '@grafana/data';

import { TraceChartSelectionEvent } from './chartSelection';

describe('TraceChartSelectionEvent', () => {
  it('carries a selection from one panel to another', () => {
    const bus = new EventBusSrv();
    const seen: Array<TraceChartSelectionEvent['payload']> = [];
    bus.subscribe(TraceChartSelectionEvent, (e) => seen.push(e.payload));

    const selection = {
      startMicros: 1,
      endMicros: 2,
      minDurationMicros: 0,
      maxDurationMicros: Number.POSITIVE_INFINITY,
    };
    bus.publish(new TraceChartSelectionEvent({ selection }));

    expect(seen).toEqual([{ selection }]);
  });

  it('carries a cleared selection too', () => {
    const bus = new EventBusSrv();
    const seen: Array<TraceChartSelectionEvent['payload']> = [];
    bus.subscribe(TraceChartSelectionEvent, (e) => seen.push(e.payload));

    bus.publish(new TraceChartSelectionEvent({ selection: null }));

    expect(seen).toEqual([{ selection: null }]);
  });
});
