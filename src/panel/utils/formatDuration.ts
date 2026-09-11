const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A duration in milliseconds, in the unit that reads best at its magnitude —
 * visum's ladder, which keeps two decimals all the way up rather than
 * collapsing long traces into "150m 0s".
 *
 * Examples: 0.45 → "450µs", 1.5 → "1.50ms", 1500 → "1.50s", 9e6 → "2.50h".
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}µs`;
  }
  if (ms < SECOND_MS) {
    return `${ms.toFixed(2)}ms`;
  }
  if (ms < MINUTE_MS) {
    return `${(ms / SECOND_MS).toFixed(2)}s`;
  }
  // Half an hour reads better in hours than in minutes, as it does in visum.
  if (ms < HOUR_MS / 2) {
    return `${(ms / MINUTE_MS).toFixed(2)}min`;
  }
  if (ms < DAY_MS) {
    return `${(ms / HOUR_MS).toFixed(2)}h`;
  }
  return `${(ms / DAY_MS).toFixed(2)}d`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * A unix millisecond timestamp as `YYYY-MM-DD HH:mm:ss.SSS` in local time.
 *
 * Fixed rather than locale-formatted: the column is read alongside other
 * timestamps and compared between people, so its shape must not depend on the
 * reader's browser.
 */
export function formatTimestampMs(ms: number): string {
  if (!ms) {
    return '';
  }
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}
