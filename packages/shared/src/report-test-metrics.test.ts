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

// Three options per question, `<q>1` the correct one (letter A).
const question = (id: string, sectionId: string | null) => ({
  id,
  sectionId,
  options: [1, 2, 3].map((n) => ({ id: `${id}${n}`, text: `${id} option ${n}` })),
  correctOptionIds: [`${id}1`],
});
const attempt = (a: Partial<MetricsAttempt> & Pick<MetricsAttempt, 'studentId' | 'score'>): MetricsAttempt => ({
  departmentId: null,
  status: 'submitted',
  durationSec: 60,
  strikesCount: 0,
  sections: {},
  answers: {},
  drawQuestionIds: Object.keys(a.answers ?? {}),
  ...a,
});

describe('computeTestMetrics: sections, pools and terminated attempts', () => {
  const metrics = computeTestMetrics({
    title: 'Sectioned',
    maxScore: 4,
    eligible: 4,
    inProgress: 2,
    // qc, qd and qe are a pool: each attempt is served one or none of them.
    questions: [
      question('qa', 's1'),
      question('qb', 's1'),
      question('qc', 's2'),
      question('qd', 's2'),
      question('qe', 's2'),
    ],
    sections: [
      { id: 's1', name: 'Aptitude', max: 2 },
      { id: 's2', name: 'Reasoning', max: 2 },
    ],
    departments: [
      { id: 'd1', name: 'Civil' },
      { id: 'd2', name: 'Mechanical' },
      { id: 'd3', name: 'Electrical' },
    ],
    attempts: [
      attempt({
        studentId: 'u3',
        departmentId: 'd2',
        status: 'terminated',
        score: 1,
        durationSec: 1500,
        strikesCount: 3,
        sections: { s1: { score: 1 }, s2: { score: 0 } },
        answers: { qa: 'qa1', qb: 'qb2', qc: null },
      }),
      attempt({
        studentId: 'u1',
        departmentId: 'd1',
        status: 'auto_submitted',
        score: 2,
        durationSec: 60,
        sections: { s1: { score: 1 }, s2: { score: 1 } },
        answers: { qa: 'qa2', qb: 'qb1', qd: 'qd1' },
      }),
      attempt({
        studentId: 'u2',
        score: 3,
        durationSec: 1200,
        strikesCount: 2,
        sections: { s1: { score: 2 }, s2: { score: 1 } },
        answers: { qa: 'qa1', qb: 'qb1', qc: 'qc1' },
      }),
    ],
  });

  it('EXP-04 terminated attempts are counted, with participation, statuses and strikes', () => {
    expect(metrics.participation).toEqual({ eligible: 4, finished: 3, inProgress: 2, notStarted: 0, ratePct: 75 });
    expect(metrics.statuses).toEqual({ submitted: 1, autoSubmitted: 1, terminated: 1 });
    expect(metrics.strikes).toEqual({ total: 5, attemptsWithStrikes: 2, terminated: 1 });
    expect(metrics.scores).toMatchObject({ mean: 2, median: 2, top: 3, bottom: 1, stdDev: 0.82, meanPct: 50 });
    expect(metrics.timeTaken).toMatchObject({ meanSec: 920, medianSec: 1200, minSec: 60, maxSec: 1500 });
    expect(metrics.timeTaken.distribution.map((b) => [b.fromMin, b.count])).toEqual([
      [0, 1],
      [5, 0],
      [10, 0],
      [15, 0],
      [20, 1],
      [25, 1],
    ]);
  });

  it('EXP-04 section averages in section order and departments in the organization order', () => {
    expect(metrics.sections).toEqual([
      { sectionId: 's1', name: 'Aptitude', max: 2, mean: 1.33, meanPct: 66.67 },
      { sectionId: 's2', name: 'Reasoning', max: 2, mean: 0.67, meanPct: 33.33 },
    ]);
    // Electrical has no attempt and u2 no department: both are left out.
    expect(metrics.departments).toEqual([
      { departmentId: 'd1', name: 'Civil', finished: 1, mean: 2, meanPct: 50 },
      { departmentId: 'd2', name: 'Mechanical', finished: 1, mean: 1, meanPct: 25 },
    ]);
  });

  it('EXP-04 pooled questions count only the attempts they were served to', () => {
    expect(
      metrics.questions.map((q) => [
        q.number,
        q.sectionName,
        q.served,
        q.answered,
        q.correct,
        q.correctRatePct,
        q.discriminationIndex,
      ]),
    ).toEqual([
      [1, 'Aptitude', 3, 3, 2, 66.67, 0],
      [2, 'Aptitude', 3, 3, 2, 66.67, 1],
      [3, 'Reasoning', 2, 1, 1, 50, 1],
      [4, 'Reasoning', 1, 1, 1, 100, null],
      [5, 'Reasoning', 0, 0, 0, 0, null],
    ]);
    // A question served to nobody is not a most-missed question.
    expect(metrics.mostMissed).toEqual([
      { number: 3, correctRatePct: 50 },
      { number: 1, correctRatePct: 66.67 },
      { number: 2, correctRatePct: 66.67 },
      { number: 4, correctRatePct: 100 },
    ]);
    expect(metrics.mostPickedWrong).toEqual([
      { number: 1, letter: 'B', text: 'qa option 2', count: 1 },
      { number: 2, letter: 'B', text: 'qb option 2', count: 1 },
    ]);
  });

  it('EXP-04 most-missed and most-picked wrong options keep at most 5, ties by number then letter', () => {
    const ids = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
    const m = computeTestMetrics({
      title: 'Six',
      maxScore: 6,
      eligible: 2,
      inProgress: 0,
      questions: ids.map((q) => question(q, null)),
      sections: [],
      departments: [],
      attempts: [
        attempt({ studentId: 'x', score: 0, answers: Object.fromEntries(ids.map((q) => [q, `${q}2`])) }),
        attempt({
          studentId: 'y',
          score: 0,
          answers: Object.fromEntries(ids.map((q, i) => [q, `${q}${i < 3 ? 3 : 2}`])),
        }),
      ],
    });
    expect(m.mostMissed.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    expect(m.mostPickedWrong.map((w) => [w.number, w.letter, w.count])).toEqual([
      [4, 'B', 2],
      [5, 'B', 2],
      [6, 'B', 2],
      [1, 'B', 1],
      [1, 'C', 1],
    ]);
  });
});
