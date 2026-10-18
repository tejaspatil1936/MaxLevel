import { describe, expect, it } from 'vitest';
import { dayLabels } from './day-labels';

describe('dayLabels', () => {
  it('TST-02 numbers tests Day 1, Day 2, … in scheduled-date order', () => {
    const labels = dayLabels([
      { id: 'c', scheduledDate: '2026-11-04' },
      { id: 'a', scheduledDate: '2026-11-02' },
      { id: 'b', scheduledDate: '2026-11-03' },
    ]);
    expect(labels).toEqual({ a: 'Day 1', b: 'Day 2', c: 'Day 3' });
  });

  it('TST-02 input order breaks ties between tests on the same date', () => {
    const labels = dayLabels([
      { id: 'second', scheduledDate: '2026-11-02' },
      { id: 'first', scheduledDate: '2026-11-01' },
      { id: 'third', scheduledDate: '2026-11-02' },
    ]);
    expect(labels).toEqual({ first: 'Day 1', second: 'Day 2', third: 'Day 3' });
  });

  it('TST-02 a stored day number is shown instead of the suggestion', () => {
    const labels = dayLabels([
      { id: 'a', scheduledDate: '2026-11-02', dayNumber: 'Mock 1' },
      { id: 'b', scheduledDate: '2026-11-03', dayNumber: null },
      { id: 'c', scheduledDate: '2026-11-04', dayNumber: '  ' },
    ]);
    expect(labels).toEqual({ a: 'Mock 1', b: 'Day 2', c: 'Day 3' });
  });

  it('TST-02 a hidden label is null', () => {
    const labels = dayLabels([{ id: 'a', scheduledDate: '2026-11-02', dayNumber: 'Mock 1', dayHidden: true }]);
    expect(labels).toEqual({ a: null });
  });

  it('TST-02 a rename or a hidden label never renumbers the other tests', () => {
    const tests = [
      { id: 'a', scheduledDate: '2026-11-02' },
      { id: 'b', scheduledDate: '2026-11-03' },
      { id: 'c', scheduledDate: '2026-11-04' },
    ];
    const plain = dayLabels(tests);
    const renamed = dayLabels([tests[0]!, { ...tests[1]!, dayNumber: 'Revision' }, tests[2]!]);
    const hidden = dayLabels([{ ...tests[0]!, dayHidden: true }, tests[1]!, tests[2]!]);
    expect(plain).toEqual({ a: 'Day 1', b: 'Day 2', c: 'Day 3' });
    expect(renamed).toEqual({ a: 'Day 1', b: 'Revision', c: 'Day 3' });
    expect(hidden).toEqual({ a: null, b: 'Day 2', c: 'Day 3' });
  });
});
