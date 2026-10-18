import { describe, expect, it } from 'vitest';
import { gradeAttempt, type GradeInput, type GradingQuestion } from './grading';

const key = (marks?: number, negativeMarks?: number): GradingQuestion => ({
  correctOptionIds: ['a'],
  ...(marks !== undefined ? { marks } : {}),
  ...(negativeMarks !== undefined ? { negativeMarks } : {}),
});

const START = 1_000_000;
const input = (over: Partial<GradeInput> = {}): GradeInput => ({
  attempt: {
    startedAt: START,
    deadlineAt: START + 600_000,
    draw: {
      questionIds: ['q2', 'q1', 'q3', 'q4'],
      optionOrder: {},
      sections: [
        { sectionId: 'quant', questionIds: ['q2', 'q1'] },
        { sectionId: 'verbal', questionIds: ['q3'] },
        { sectionId: null, questionIds: ['q4'] },
      ],
    },
  },
  questions: new Map([
    ['q1', key()],
    ['q2', key(3)],
    ['q3', key()],
    ['q4', key(undefined, 0)],
    ['q9', key(100)],
  ]),
  sections: [{ id: 'quant' }, { id: 'verbal', marks: 2, negativeMarks: 1 }],
  settings: { marking: { marks: 1, negativeMarks: 0.25, preset: 'p1_m025' }, floorAtZero: false },
  answers: { q1: { optionId: 'b' }, q2: { optionId: 'a' }, q3: { optionId: 'c' }, q9: { optionId: 'a' } },
  submittedAt: START + 90_500,
  ...over,
});

describe('gradeAttempt', () => {
  it('EX-17 Q-06 grades only the stored draw, by its sections, with marks resolved question, section, then test', () => {
    const r = gradeAttempt(input());
    expect(r).toMatchObject({ score: 3 - 0.25 - 1, max: 3 + 1 + 2 + 1, correct: 1, incorrect: 2, unanswered: 1 });
    expect(r.sections).toEqual({
      quant: { score: 2.75, max: 4, correct: 1, incorrect: 1, unanswered: 0 },
      verbal: { score: -1, max: 2, correct: 0, incorrect: 1, unanswered: 0 },
      none: { score: 0, max: 1, correct: 0, incorrect: 0, unanswered: 1 },
    });
    expect(r.pct).toBe(25);
    expect(r.passed).toBeUndefined();
  });

  it('EX-17 the time taken runs from the start to the submission, never past the deadline', () => {
    expect(gradeAttempt(input()).durationSec).toBe(90);
    expect(gradeAttempt(input({ submittedAt: START + 720_000 })).durationSec, 'auto-submit after the grace').toBe(600);
  });

  it('EX-17 applies the passing marks and floor at zero of the settings', () => {
    const wrong = { q1: { optionId: 'b' }, q3: { optionId: 'b' } };
    const floored = gradeAttempt(
      input({ answers: wrong, settings: { ...input().settings, floorAtZero: true, passingMarks: 1 } }),
    );
    expect(floored.score).toBe(0);
    expect(floored.passed).toBe(false);
    expect(gradeAttempt(input({ answers: wrong })).score).toBe(-1.25);
  });

  it('EX-17 a drawn question without an answer key still counts toward the maximum and is never correct', () => {
    const questions = new Map(input().questions);
    questions.delete('q2');
    const r = gradeAttempt(input({ questions }));
    expect(r).toMatchObject({ max: 5, correct: 0, incorrect: 3 });
  });
});
