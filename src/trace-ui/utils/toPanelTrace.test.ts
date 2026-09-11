import type { Trace } from '../types/trace';
import { toPanelTrace } from './toPanelTrace';

const trace: Trace = {
  traceID: 't1',
  warnings: [],
  processes: { p1: { serviceName: 'frontend', tags: [{ key: 'host', value: 'a', type: 'string' }] } },
  spans: [
    {
      traceID: 't1',
      spanID: 'root',
      operationName: 'GET /',
      processID: 'p1',
      startTime: 1_700_000_000_000_000,
      duration: 25_000,
      tags: [{ key: 'error', value: 'true', type: 'string' }],
      references: [],
      logs: [{ timestamp: 1_700_000_000_500_000, fields: [{ key: 'event', value: 'x', type: 'string' }] }],
      warnings: ['clock skew'],
    },
    {
      traceID: 't1',
      spanID: 'child',
      operationName: 'SELECT',
      processID: 'p1',
      startTime: 1_700_000_000_010_000,
      duration: 5_000,
      tags: [],
      references: [{ refType: 'CHILD_OF', spanID: 'root', traceID: 't1' }],
    },
  ],
};

describe('toPanelTrace', () => {
  it('converts microseconds to milliseconds', () => {
    const panel = toPanelTrace(trace);
    expect(panel.spans[0].startTime).toBe(1_700_000_000_000);
    expect(panel.spans[0].duration).toBe(25);
    expect(panel.spans[1].duration).toBe(5);
  });

  it('converts log timestamps too', () => {
    expect(toPanelTrace(trace).spans[0].logs[0].timestamp).toBe(1_700_000_000_500);
  });

  it('defaults absent logs to an empty array', () => {
    // The panel model requires `logs`; the Jaeger model makes it optional.
    expect(toPanelTrace(trace).spans[1].logs).toEqual([]);
  });

  it('preserves ids, references, tags, warnings and processes', () => {
    const panel = toPanelTrace(trace);
    expect(panel.traceID).toBe('t1');
    expect(panel.spans[1].references).toEqual([{ refType: 'CHILD_OF', spanID: 'root', traceID: 't1' }]);
    expect(panel.spans[0].tags).toEqual([{ key: 'error', value: 'true', type: 'string' }]);
    expect(panel.spans[0].warnings).toEqual(['clock skew']);
    expect(panel.processes.p1.serviceName).toBe('frontend');
    expect(panel.processes.p1.tags).toEqual([{ key: 'host', value: 'a', type: 'string' }]);
  });
});
