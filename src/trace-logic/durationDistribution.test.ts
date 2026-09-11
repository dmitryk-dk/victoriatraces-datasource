import {
  buildHistogramCells,
  quantile,
  valueFraction,
} from './durationDistribution';

const tones = (cells: ReturnType<typeof buildHistogramCells>) =>
  new Set(cells.filter((c) => c.count > 0).map((c) => c.tone));

describe('quantile', () => {
  it('interpolates linearly', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('handles empty and single-element arrays', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.99)).toBe(7);
  });
});

describe('buildHistogramCells', () => {
  it('identical durations → a single full green cell', () => {
    const cells = buildHistogramCells(Array(50).fill(120));
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ tone: 'green', intensity: 1, count: 50 });
  });

  it('small spread → green and yellow only, no red', () => {
    // 100µs..500µs, median 300µs: slowest is 1.67× typical — mild spread.
    const sample = Array.from({ length: 101 }, (_, i) => 100 + i * 4);
    const t = tones(buildHistogramCells(sample));
    expect(t.has('red')).toBe(false);
    expect(t.has('green')).toBe(true);
    expect(t.has('yellow')).toBe(true);
  });

  it('seconds scale: 3× typical is red, not yellow — absolute excess wins', () => {
    // Ratios are scale-blind: 10s → 30s is "only" 3×, but 20 extra seconds of
    // real waiting must be red. (At µs/ms scale 3× stays yellow.)
    const S = 1_000_000; // 1s in µs
    const sample = [...Array(90).fill(10 * S), ...Array(10).fill(30 * S)].sort(
      (a, b) => a - b,
    );
    const cells = buildHistogramCells(sample);
    const slowest = cells.filter((c) => c.count > 0).at(-1);
    expect(slowest?.tone).toBe('red');
  });

  it('seconds scale: ≥1s slower than typical is at least yellow', () => {
    const S = 1_000_000;
    // Median 10s; a 11.5s cluster is only 1.15× (green by ratio) but 1.5s
    // of extra waiting → yellow.
    const sample = [
      ...Array(90).fill(10 * S),
      ...Array(10).fill(11.5 * S),
    ].sort((a, b) => a - b);
    const cells = buildHistogramCells(sample);
    const slowest = cells.filter((c) => c.count > 0).at(-1);
    expect(slowest?.tone).toBe('yellow');
  });

  it('a rare fast outlier does not paint the typical duration red', () => {
    // The operation "usually always takes 100ms" — one lucky 5ms sample and a
    // slow 1.3s tail must not turn the normal 100ms cluster red.
    const sample = [
      5_000, // 5ms outlier
      ...Array(90).fill(100_000), // typical 100ms
      ...Array(5).fill(1_300_000), // 1.3s tail
    ].sort((a, b) => a - b);
    const cells = buildHistogramCells(sample);
    const typical = cells.reduce((a, b) => (b.count > a.count ? b : a));
    expect(typical.tone).toBe('green');
    // The genuinely slow tail is still called out.
    const last = cells.filter((c) => c.count > 0).at(-1);
    expect(last?.tone).toBe('red');
  });

  it('wide spread → all three tones, ordered green→yellow→red', () => {
    const sample = [
      ...Array(60).fill(100), // 1× — green
      ...Array(30).fill(300), // 3× — yellow
      ...Array(10).fill(1000), // 10× — red
    ].sort((a, b) => a - b);
    const cells = buildHistogramCells(sample);
    expect(tones(cells)).toEqual(new Set(['green', 'yellow', 'red']));
    const order = { green: 0, yellow: 1, red: 2 };
    for (let i = 1; i < cells.length; i++) {
      expect(order[cells[i].tone]).toBeGreaterThanOrEqual(
        order[cells[i - 1].tone],
      );
    }
  });

  it('density: the dominant cluster gets the highest intensity', () => {
    const sample = [...Array(90).fill(100), ...Array(10).fill(1000)].sort(
      (a, b) => a - b,
    );
    const cells = buildHistogramCells(sample);
    const fullest = cells.reduce((a, b) => (b.count > a.count ? b : a));
    expect(fullest.intensity).toBe(1);
    // The cluster at 100µs is the fullest bucket → it IS the leftmost cell.
    expect(cells.indexOf(fullest)).toBe(0);
    // Sparse but non-empty buckets stay visible.
    const sparse = cells.find((c) => c.count > 0 && c.count < fullest.count);
    expect(sparse?.intensity ?? 0).toBeGreaterThan(0);
  });

  it('every hit lands in exactly one bucket', () => {
    const sample = Array.from({ length: 137 }, (_, i) => 50 + i * 13);
    const cells = buildHistogramCells(sample);
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(sample.length);
  });

  it('all-zero durations stay green instead of dividing by zero', () => {
    const cells = buildHistogramCells([0, 0, 0]);
    expect(tones(cells)).toEqual(new Set(['green']));
  });

  it('empty sample → no cells', () => {
    expect(buildHistogramCells([])).toEqual([]);
  });
});

describe('valueFraction', () => {
  it('quickest → 0, slowest → 1, clamped outside', () => {
    const sample = [10, 20, 30, 40, 50];
    expect(valueFraction(sample, 10)).toBe(0);
    expect(valueFraction(sample, 50)).toBe(1);
    expect(valueFraction(sample, 5)).toBe(0);
    expect(valueFraction(sample, 500)).toBe(1);
  });

  it('all-equal sample centers the marker', () => {
    expect(valueFraction([7, 7, 7], 7)).toBe(0.5);
  });

  it('uses a log axis for heavy-tailed samples', () => {
    // min 10, max 10000 (1000× spread) → log axis: 100 (10× above min,
    // halfway in log space) sits near the middle, not squashed at the left.
    const sample = [10, 100, 10000];
    const f = valueFraction(sample, 100);
    expect(f).toBeGreaterThan(0.25);
    expect(f).toBeLessThan(0.4);
  });
});
