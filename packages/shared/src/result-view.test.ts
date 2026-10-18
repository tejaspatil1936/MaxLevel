import { describe, expect, it } from 'vitest';
import { resultDetailShown, studentResult, type StudentResultInput } from './result-view';
import { OTHER_QUESTIONS, studentResultSchema } from './results';
import { SYSTEM_DEFAULTS, type Settings } from './settings';

const window = { start: 1_000_000, end: 4_600_000 };
const settings = (s: Partial<Settings> = {}): Settings => ({
  ...SYSTEM_DEFAULTS,
  window,
  resultRelease: 'immediate',
  resultDetail: 'full',
  marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' },
  ...s,
});
const score = { score: 0.75, max: 2, correct: 1, incorrect: 1, unanswered: 0 };
const input = (s: Partial<Settings> = {}, release: StudentResultInput['release'] = {}): StudentResultInput => ({
  attempt: {
    id: 'att-1',
    testId: 't1',
    status: 'submitted',
    strikesCount: 1,
    draw: {
      questionIds: ['q2', 'q1'],
      optionOrder: { q1: ['b', 'a'], q2: ['a', 'b'] },
      sections: [
        { sectionId: 's1', questionIds: ['q2'] },
        { sectionId: null, questionIds: ['q1'] },
      ],
    },
    result: {
      ...score,
      pct: 37.5,
      durationSec: 600,
      sections: {
        s1: { score: 1, max: 1, correct: 1, incorrect: 0, unanswered: 0 },
        none: { ...score, score: -0.25, max: 1, correct: 0 },
      },
    },
  },
  test: { title: 'Aptitude', dayLabel: 'Day 1', sections: [{ id: 's1', name: 'Numbers', order: 1 }] },
  settings: settings(s),
  release,
  now: window.end + 1,
  review: {
    questions: new Map([
      [
        'q1',
        {
          prompt: 'One?',
          options: [
            { id: 'a', text: 'A1' },
            { id: 'b', text: 'B1' },
          ],
          correctOptionIds: ['a'],
        },
      ],
      [
        'q2',
        {
          prompt: 'Two?',
          options: [
            { id: 'a', text: 'A2' },
            { id: 'b', text: 'B2' },
          ],
          correctOptionIds: ['b'],
          explanation: 'Because.',
        },
      ],
    ]),
    answers: { q1: { optionId: 'b' }, q2: { optionId: 'b' } },
  },
});
const hasKey = (body: unknown) => /correctOptionIds|explanation|Because\./.test(JSON.stringify(body));

describe('studentResult', () => {
  it('RES-01 DATA-05 pending, withdrawn and never results carry no score, sections, review or answer key', () => {
    for (const [s, release, state] of [
      [{ resultRelease: 'manual' }, {}, 'pending'],
      [{ resultRelease: 'after_close' }, { resultsReleasedAt: null }, 'pending'],
      [{}, { resultsWithdrawn: true }, 'withdrawn'],
      [{ resultRelease: 'never' }, {}, 'never'],
    ] as const) {
      const body = studentResult(input(s, release));
      expect(body.release).toBe(state);
      for (const k of ['detail', 'score', 'max', 'pct', 'durationSec', 'rank', 'sections', 'review'])
        expect(k in body, `${state}: ${k}`).toBe(false);
      expect(hasKey(body), state).toBe(false);
    }
  });

  it('RES-01 RES-02 released score-only results have the score and no sections; sections detail has them in order', () => {
    const scoreOnly = studentResult(input({ resultDetail: 'score' }));
    expect(scoreOnly).toMatchObject({
      release: 'released',
      detail: 'score',
      score: 0.75,
      max: 2,
      pct: 37.5,
      durationSec: 600,
    });
    expect('sections' in scoreOnly).toBe(false);
    const sections = studentResult(input({ resultDetail: 'sections' }));
    expect(sections.sections).toEqual([
      { sectionId: 's1', name: 'Numbers', score: 1, max: 1, correct: 1, incorrect: 0, unanswered: 0 },
      { sectionId: null, name: OTHER_QUESTIONS, score: -0.25, max: 1, correct: 0, incorrect: 1, unanswered: 0 },
    ]);
    expect(hasKey(sections)).toBe(false);
  });

  it('RES-03 SER-10 a released full review lists the draw in exam order with marks, and explanations only where set', () => {
    const body = studentResult(input({}, { resultsReleasedAt: 5 }));
    expect(body.review).toEqual([
      {
        questionId: 'q2',
        sectionId: 's1',
        prompt: 'Two?',
        options: [
          { id: 'a', text: 'A2' },
          { id: 'b', text: 'B2' },
        ],
        chosenOptionId: 'b',
        correctOptionIds: ['b'],
        marks: 1,
        explanation: 'Because.',
      },
      {
        questionId: 'q1',
        sectionId: null,
        prompt: 'One?',
        options: [
          { id: 'b', text: 'B1' },
          { id: 'a', text: 'A1' },
        ],
        chosenOptionId: 'b',
        correctOptionIds: ['a'],
        marks: -0.25,
      },
    ]);
    expect(studentResultSchema.parse(body)).toEqual(body);
  });

  it('SER-09 DATA-05 a full review is shown as sections while a flexible window is open', () => {
    const open = {
      ...input({ timingMode: 'flexible', resultRelease: 'manual' }, { resultsReleasedAt: 5 }),
      now: window.end - 1,
    };
    const body = studentResult(open);
    expect(body.detail).toBe('sections');
    expect(hasKey(body)).toBe(false);
    expect(resultDetailShown(open.settings, open.release, window.end)).toBe('full');
  });
});
