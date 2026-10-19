import { describe, expect, it } from 'vitest';
import { computeTestMetrics, type MetricsAttempt } from './report-metrics';

// The reported test of the phase 7 acceptance fixtures (tests/acceptance/fixtures/reports.ts): the `basic` questions,
// five students of Computer and IT scoring 4, 3, 2, 0 and 1 of 4.
const OPTIONS: Record<string, string[]> = {
  q1: ['20 m/s', '24 m/s', '30 m/s', '40 m/s'],
  q2: ['25', '30', '35', '40'],
  q3: ['3', '4', '5', '6'],
  q4: ['24', '32', '48', '64'],
};
const CORRECT: Record<string, string> = { q1: '20 m/s', q2: '30', q3: '4', q4: '32' };
const optionId = (q: string, text: string) => `${q}-${OPTIONS[q]!.indexOf(text)}`;
const QUESTIONS = Object.keys(OPTIONS).map((q) => ({
  id: q,
  sectionId: null,
  options: OPTIONS[q]!.map((text) => ({ id: optionId(q, text), text })),
  correctOptionIds: [optionId(q, CORRECT[q]!)],
}));
const DEPARTMENTS = [
  { id: 'dep-computer', name: 'Computer' },
  { id: 'dep-it', name: 'IT' },
  { id: 'dep-mech', name: 'Mechanical' },
];

function sat(n: number, dep: string, score: number, minutes: number, picks: string[], strikes = 0): MetricsAttempt {
  const answers = Object.fromEntries(Object.keys(OPTIONS).map((q, i) => [q, picks[i] ? optionId(q, picks[i]) : null]));
  return {
    studentId: `stu-a-${String(n).padStart(2, '0')}`,
    departmentId: dep,
    status: 'submitted',
    score,
    durationSec: minutes * 60,
    strikesCount: strikes,
    sections: { none: { score } },
    answers,
    drawQuestionIds: Object.keys(OPTIONS),
  };
}

const SITTINGS: MetricsAttempt[] = [
  sat(1, 'dep-computer', 4, 10, ['20 m/s', '30', '4', '32']),
  sat(2, 'dep-it', 3, 12, ['20 m/s', '30', '4', '64']),
  sat(5, 'dep-computer', 2, 15, ['20 m/s', '25', '4', '24'], 1),
  sat(6, 'dep-it', 0, 5, ['24 m/s', '25', '3', '24']),
  sat(9, 'dep-computer', 1, 8, ['24 m/s', '30', '3']),
];

describe('computeTestMetrics: the reported test', () => {
  const left = [
    { ...SITTINGS[0]!, studentId: 'stu-a-03', status: 'reset' },
    { ...SITTINGS[0]!, studentId: 'stu-a-04', status: 'in_progress' },
  ] as unknown as MetricsAttempt[];
  const metrics = computeTestMetrics({
    title: 'Day 1: Quantitative aptitude',
    maxScore: 4,
    eligible: 10,
    inProgress: 0,
    questions: QUESTIONS,
    sections: [],
    departments: DEPARTMENTS,
    attempts: [...SITTINGS, ...left],
  });

  it('EXP-04 participation, statuses, scores, departments, strikes and time as the fixtures expect', () => {
    expect(metrics).toMatchObject({
      version: 1,
      scope: 'test',
      title: 'Day 1: Quantitative aptitude',
      maxScore: 4,
      participation: { eligible: 10, finished: 5, inProgress: 0, notStarted: 5, ratePct: 50 },
      statuses: { submitted: 5, autoSubmitted: 0, terminated: 0 },
      scores: { mean: 2, median: 2, top: 4, bottom: 0, stdDev: 1.41, meanPct: 50 },
      sections: [],
      departments: [
        { departmentId: 'dep-computer', name: 'Computer', finished: 3, mean: 2.33, meanPct: 58.33 },
        { departmentId: 'dep-it', name: 'IT', finished: 2, mean: 1.5, meanPct: 37.5 },
      ],
      strikes: { total: 1, attemptsWithStrikes: 1, terminated: 0 },
      timeTaken: { meanSec: 600, medianSec: 600, minSec: 300, maxSec: 900 },
      trends: [],
      discriminationGroupPct: 27,
    });
    expect(metrics.scores.distribution.map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 0, 1]);
    expect(metrics.timeTaken.distribution.map((b) => b.count)).toEqual([0, 2, 2, 1]);
  });

  it('EXP-04 per-question figures, most-missed questions and most-picked wrong options', () => {
    expect(
      metrics.questions.map(({ number, served, answered, correct, correctRatePct, discriminationIndex }) => ({
        number,
        served,
        answered,
        correct,
        correctRatePct,
        discriminationIndex,
      })),
    ).toEqual([
      { number: 1, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 1 },
      { number: 2, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 0.5 },
      { number: 3, served: 5, answered: 5, correct: 3, correctRatePct: 60, discriminationIndex: 1 },
      { number: 4, served: 5, answered: 4, correct: 1, correctRatePct: 20, discriminationIndex: 0.5 },
    ]);
    expect(metrics.questions.map((q) => [q.questionId, q.sectionName])).toEqual([
      ['q1', null],
      ['q2', null],
      ['q3', null],
      ['q4', null],
    ]);
    expect(metrics.questions[3]!.wrongPicks).toEqual([
      { letter: 'A', text: '24', count: 2 },
      { letter: 'D', text: '64', count: 1 },
    ]);
    expect(metrics.mostMissed).toEqual([
      { number: 4, correctRatePct: 20 },
      { number: 1, correctRatePct: 60 },
      { number: 2, correctRatePct: 60 },
      { number: 3, correctRatePct: 60 },
    ]);
    expect(metrics.mostPickedWrong).toEqual([
      { number: 1, letter: 'B', text: '24 m/s', count: 2 },
      { number: 2, letter: 'A', text: '25', count: 2 },
      { number: 3, letter: 'A', text: '3', count: 2 },
      { number: 4, letter: 'A', text: '24', count: 2 },
      { number: 4, letter: 'D', text: '64', count: 1 },
    ]);
  });

  it('EXP-04 leaves out reset and in-progress attempts and holds no student ID', () => {
    expect(JSON.stringify(metrics)).not.toMatch(/stu-a-/);
  });
});
