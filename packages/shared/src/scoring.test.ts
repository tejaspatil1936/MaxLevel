import { describe, expect, it } from 'vitest';
import { NO_SECTION_KEY, scoreAttempt, type ScoringQuestion } from './scoring';

const q = (id: string, sectionId: string | null, marks = 1, negativeMarks = 0.25): ScoringQuestion => ({
  id,
  sectionId,
  correctOptionIds: ['a'],
  marks,
  negativeMarks,
});

const questions = [
  q('q1', 'quant'),
  q('q2', 'quant'),
  q('q3', 'quant', 2, 1),
  q('q4', 'verbal', 4, 1),
  q('q5', 'verbal'),
];

describe('scoreAttempt', () => {
  it('Q-09 a correct answer adds its marks, a wrong one takes off its negative marks', () => {
    const r = scoreAttempt({
      questions,
      answers: { q1: { optionId: 'a' }, q3: { optionId: 'b' }, q4: { optionId: 'a' } },
    });
    expect(r).toMatchObject({ score: 1 - 1 + 4, max: 9, correct: 2, incorrect: 1, unanswered: 2 });
  });

  it('Q-09 an unanswered question, missing or with optionId null, scores 0', () => {
    const r = scoreAttempt({ questions, answers: { q1: { optionId: null }, q2: undefined } });
    expect(r).toMatchObject({ score: 0, max: 9, correct: 0, incorrect: 0, unanswered: 5, pct: 0 });
  });

  it('Q-09 max sums the marks and pct is score over max × 100', () => {
    const r = scoreAttempt({ questions, answers: { q4: { optionId: 'a' }, q5: { optionId: 'a' } } });
    expect(r.max).toBe(9);
    expect(r.score).toBe(5);
    expect(r.pct).toBeCloseTo((5 / 9) * 100, 6);
    expect(scoreAttempt({ questions: [], answers: {} })).toMatchObject({ score: 0, max: 0, pct: 0 });
  });

  it('Q-09 section totals add up to the totals', () => {
    const answers = { q1: { optionId: 'a' }, q2: { optionId: 'c' }, q4: { optionId: 'a' }, q5: { optionId: 'd' } };
    const r = scoreAttempt({ questions, answers });
    expect(r.sections).toEqual({
      quant: { score: 0.75, max: 4, correct: 1, incorrect: 1, unanswered: 1 },
      verbal: { score: 3.75, max: 5, correct: 1, incorrect: 1, unanswered: 0 },
    });
    const sum = (k: 'score' | 'max' | 'correct' | 'incorrect' | 'unanswered') =>
      Object.values(r.sections).reduce((a, s) => a + s[k], 0);
    for (const k of ['score', 'max', 'correct', 'incorrect', 'unanswered'] as const) expect(sum(k)).toBe(r[k]);
  });

  it('Q-09 questions in no section are totalled under their own key', () => {
    const r = scoreAttempt({ questions: [q('q1', null), q('q2', 'quant')], answers: { q1: { optionId: 'a' } } });
    expect(r.sections[NO_SECTION_KEY]).toEqual({ score: 1, max: 1, correct: 1, incorrect: 0, unanswered: 0 });
    expect(r.score).toBe(1);
  });

  it('Q-09 passed is set only with passing marks, as score >= passing marks', () => {
    const answers = { q4: { optionId: 'a' } };
    expect(scoreAttempt({ questions, answers })).not.toHaveProperty('passed');
    expect(scoreAttempt({ questions, answers, passingMarks: 4 }).passed).toBe(true);
    expect(scoreAttempt({ questions, answers, passingMarks: 4.5 }).passed).toBe(false);
  });

  it('Q-09 a negative total stays negative unless floorAtZero, which is off by default', () => {
    const answers = { q3: { optionId: 'b' }, q5: { optionId: 'b' } };
    expect(scoreAttempt({ questions, answers }).score).toBe(-1.25);
    expect(scoreAttempt({ questions, answers, floorAtZero: false }).score).toBe(-1.25);
    const floored = scoreAttempt({ questions, answers, floorAtZero: true, passingMarks: 1 });
    expect(floored).toMatchObject({ score: 0, pct: 0, passed: false });
    expect(floored.sections.quant!.score, 'section scores are not floored').toBe(-1);
  });

  it('Q-09 fractional marks add up without floating-point noise', () => {
    const tenths = [q('q1', null, 0.1, 0), q('q2', null, 0.2, 0)];
    const r = scoreAttempt({ questions: tenths, answers: { q1: { optionId: 'a' }, q2: { optionId: 'a' } } });
    expect(r).toMatchObject({ score: 0.3, max: 0.3, pct: 100 });
  });
});
