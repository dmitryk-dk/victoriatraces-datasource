import { collapseDuplicateLabels, niceTimeStep, rulerMarks } from './timelineRuler';

describe('niceTimeStep', () => {
  it('rounds up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceTimeStep(1.3)).toBe(2);
    expect(niceTimeStep(3)).toBe(5);
    expect(niceTimeStep(7)).toBe(10);
    expect(niceTimeStep(142)).toBe(200);
    expect(niceTimeStep(0.03)).toBe(0.05);
  });

  it('is safe on a zero or negative span', () => {
    expect(niceTimeStep(0)).toBe(1);
    expect(niceTimeStep(-5)).toBe(1);
  });
});

describe('rulerMarks', () => {
  it('ticks on round values instead of even fractions of the span', () => {
    // 500ms over a 480px ruler: six slots of 80px, so a 100ms step.
    expect(rulerMarks(480, 500).map((m) => m.valueMs)).toEqual([0, 100, 200, 300, 400, 500]);
  });

  it('always ends on the full duration', () => {
    const marks = rulerMarks(480, 512);
    expect(marks[marks.length - 1]).toEqual({ valueMs: 512, position: 100 });
  });

  it('drops a round tick that would collide with the final one', () => {
    // 505 would put a 500ms tick a pixel away from the end.
    expect(rulerMarks(480, 505).map((m) => m.valueMs)).toEqual([0, 100, 200, 300, 400, 505]);
  });

  it('positions each mark as a percentage of the span', () => {
    expect(rulerMarks(480, 500).map((m) => m.position)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('falls back to a single mark without a span or a width', () => {
    expect(rulerMarks(480, 0)).toEqual([{ valueMs: 0, position: 0 }]);
    expect(rulerMarks(0, 500)).toEqual([{ valueMs: 0, position: 0 }]);
  });
});

describe('collapseDuplicateLabels', () => {
  const marks = [
    { valueMs: 0, position: 0 },
    { valueMs: 0.4, position: 50 },
    { valueMs: 0.8, position: 100 },
  ];

  it('keeps one mark per distinct label', () => {
    // A coarse formatter renders all three as "0ms"; three identical labels
    // in a row read as a rendering fault.
    const labelled = collapseDuplicateLabels(marks, () => '0ms');
    expect(labelled).toHaveLength(1);
  });

  it('prefers the last mark when the final label repeats', () => {
    const labelled = collapseDuplicateLabels(marks, (v) => (v === 0 ? '0ms' : '1ms'));
    expect(labelled.map((m) => m.valueMs)).toEqual([0, 0.8]);
  });

  it('keeps marks whose labels differ', () => {
    const labelled = collapseDuplicateLabels(marks, (v) => `${v}ms`);
    expect(labelled.map((m) => m.label)).toEqual(['0ms', '0.4ms', '0.8ms']);
  });
});
