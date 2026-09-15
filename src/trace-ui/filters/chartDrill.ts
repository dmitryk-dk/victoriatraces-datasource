import type { ChartSelection } from '../components/heatmapGrid';
import { parseDurationToNs } from './logsql';
import type { TraceFilter } from './types';

/**
 * The duration filter a chart selection drills to.
 *
 * The selection intersects the filter already in force rather than replacing
 * it: it may only ever narrow the range, or a full-height drag on a chart that
 * is already duration-filtered would bring back the traces that filter excluded
 * and the drilled rows would stop matching the cells the user selected.
 *
 * Returns undefined when neither side bounds anything.
 */
export function drillDurationFilter(
  active: TraceFilter | undefined,
  selection: ChartSelection
): TraceFilter | undefined {
  const activeMinMicros = active?.kind === 'duration' ? toMicros(active.min) : undefined;
  const activeMaxMicros = active?.kind === 'duration' ? toMicros(active.max) : undefined;

  const min = Math.max(selection.minDurationMicros, activeMinMicros ?? 0);
  const max = Math.min(
    selection.maxDurationMicros,
    activeMaxMicros ?? Number.POSITIVE_INFINITY
  );

  if (min <= 0 && !Number.isFinite(max)) {
    return undefined;
  }
  return {
    kind: 'duration',
    min: min > 0 ? `${Math.round(min)}us` : undefined,
    max: Number.isFinite(max) ? `${Math.round(max)}us` : undefined,
  };
}

function toMicros(value: string | undefined): number | undefined {
  const ns = parseDurationToNs(value);
  return ns === undefined ? undefined : ns / 1000;
}
