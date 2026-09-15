import { formatDurationMs, formatTimestampMs } from '../../panel/utils/formatDuration';

export { colorForService as serviceColor } from '../../panel/utils/serviceColor';

/** Trace data is microsecond-based throughout; the shared formatters take ms. */
export function formatMicros(micros: number): string {
  return formatDurationMs(micros / 1000);
}

export function formatTimestampMicros(micros: number): string {
  return formatTimestampMs(Math.floor(micros / 1000));
}
