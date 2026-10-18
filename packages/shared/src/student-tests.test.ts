import { describe, expect, it } from 'vitest';
import { studentDashboardSchema, studentTestPageSchema, studentTestState } from './student-tests';

const MIN = 60_000;
const start = Date.UTC(2026, 10, 2, 3, 50); // 2 Nov 2026, 09:20 IST
const fixed = {
  timingMode: 'fixed',
  window: { start, end: start + 60 * MIN },
  durationMin: 60,
  lateEntryCutoffMin: 15,
  windowEndPolicy: 'full_duration',
} as const;
const flexible = {
  ...fixed,
  timingMode: 'flexible',
  durationMin: 45,
  window: { start, end: start + 180 * MIN },
} as const;

describe('studentTestState', () => {
  it('US-ST-03 a test is upcoming before its window, live until the last start time, then not shown', () => {
    expect(studentTestState(fixed, start - 1)).toBe('upcoming');
    expect(studentTestState(fixed, start)).toBe('live');
    expect(studentTestState(fixed, start + 15 * MIN)).toBe('live');
    expect(studentTestState(fixed, start + 15 * MIN + 1)).toBeNull();
    expect(studentTestState(flexible, start + 135 * MIN)).toBe('live');
    expect(studentTestState(flexible, start + 135 * MIN + 1)).toBeNull();
    expect(studentTestState({ ...fixed, window: null }, start)).toBeNull();
  });

  it('US-ST-03 the attempt decides first: finished stays finished, in progress can be resumed after the last start', () => {
    const late = start + 40 * MIN;
    expect(studentTestState(fixed, late, 'in_progress')).toBe('in_progress');
    expect(studentTestState(fixed, start - MIN, 'submitted')).toBe('finished');
    for (const status of ['submitted', 'auto_submitted', 'terminated'] as const)
      expect(studentTestState(fixed, late, status)).toBe('finished');
    expect(studentTestState(fixed, start, 'reset')).toBe('live');
  });
});

describe('student dashboard schemas', () => {
  it('DATA-05 parsing drops an answer key or explanation that reaches the response', () => {
    const item = {
      testId: 't1',
      title: 'Aptitude',
      dayLabel: 'Day 1',
      window: fixed.window,
      durationMin: 60,
      lastStartAt: start + 15 * MIN,
      correctOptionIds: ['a'],
      explanation: 'Because.',
    };
    const dash = studentDashboardSchema.parse({ timezone: 'Asia/Kolkata', live: [item], upcoming: [], completed: [] });
    const page = studentTestPageSchema.parse({
      ...item,
      timezone: 'Asia/Kolkata',
      state: 'live',
      questionCount: 4,
      sections: [],
      marking: { marks: 1, negativeMarks: 0, preset: 'p1_0' },
      maxStrikes: 3,
      exam: {
        timingMode: 'fixed',
        windowEndPolicy: 'full_duration',
        fullscreenRequired: true,
        cameraRequired: true,
        secondCamera: false,
        devtoolsPolicy: 'block',
      },
    });
    expect(page.exam).not.toHaveProperty('devtoolsPolicy');
    for (const body of [dash, page]) {
      expect(JSON.stringify(body)).not.toContain('correctOptionIds');
      expect(JSON.stringify(body)).not.toContain('explanation');
    }
  });
});
