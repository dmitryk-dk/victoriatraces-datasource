import { formatDurationMs, formatTimestampMs } from './formatDuration';

describe('formatDurationMs', () => {
  it('uses microseconds below a millisecond', () => {
    expect(formatDurationMs(0.45)).toBe('450µs');
  });

  it('uses milliseconds below a second', () => {
    expect(formatDurationMs(1.5)).toBe('1.50ms');
    expect(formatDurationMs(999)).toBe('999.00ms');
  });

  it('uses seconds below a minute', () => {
    expect(formatDurationMs(1500)).toBe('1.50s');
  });

  it('uses minutes past a minute', () => {
    // "125m 30s" is bulkier and loses precision next to "2.09 min".
    expect(formatDurationMs(90_000)).toBe('1.50min');
  });

  it('uses hours past half an hour', () => {
    expect(formatDurationMs(2.5 * 60 * 60 * 1000)).toBe('2.50h');
  });

  it('uses days past a day', () => {
    expect(formatDurationMs(2 * 24 * 60 * 60 * 1000)).toBe('2.00d');
  });

  it('reports nothing for a zero duration', () => {
    expect(formatDurationMs(0)).toBe('0µs');
  });
});

describe('formatTimestampMs', () => {
  it('formats to a fixed, sortable pattern rather than the browser locale', () => {
    // toLocaleString varies by browser and locale, so two readers comparing
    // screenshots see different column formats.
    expect(formatTimestampMs(Date.UTC(2026, 7, 18, 10, 5, 3, 42))).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/
    );
  });

  it('keeps millisecond precision', () => {
    expect(formatTimestampMs(Date.UTC(2026, 7, 18, 10, 5, 3, 42))).toMatch(/\.042$/);
  });

  it('has nothing to show without a timestamp', () => {
    expect(formatTimestampMs(0)).toBe('');
  });
});
