import { describe, expect, it } from 'vitest';
import { computeSeriesMetrics, type MetricsAttempt } from './report-metrics';

const DEPARTMENTS = [
  { id: 'dep-computer', name: 'Computer' },
  { id: 'dep-it', name: 'IT' },
  { id: 'dep-mech', name: 'Mechanical' },
];
const graded = (
  studentId: string,
  departmentId: string | null,
  score: number,
  durationSec: number,
  status: string = 'submitted',
) =>
  ({
    studentId,
    departmentId,
    status,
    score,
    durationSec,
    strikesCount: status === 'terminated' ? 3 : 0,
    sections: {},
    answers: {},
    drawQuestionIds: [],
  }) as unknown as MetricsAttempt;

describe('computeSeriesMetrics', () => {
  it('EXP-04 the reported series: totals, departments, figures over attempts and trends in schedule order', () => {
    const day = (id: string, heading: string, scheduledDate: string, attempts: MetricsAttempt[]) => ({
      id,
      heading,
      scheduledDate,
      windowStart: Date.parse(scheduledDate),
      maxScore: 4,
      attempts,
    });
    const metrics = computeSeriesMetrics({
      title: 'Placement 2026',
      eligible: 10,
      departments: DEPARTMENTS,
      // Day 2 first: the trends follow the schedule, not the input order.
      tests: [
        day('t2', 'Day 2: Logical reasoning', '2026-11-02', [
          graded('s1', 'dep-computer', 3, 300),
          graded('s2', 'dep-it', 1, 600),
          graded('s5', 'dep-computer', 2, 480),
        ]),
        day('t1', 'Day 1: Quantitative aptitude', '2026-11-01', [
          graded('s1', 'dep-computer', 4, 600),
          graded('s2', 'dep-it', 2, 900),
          graded('s9', 'dep-computer', 4, 600, 'reset'),
          graded('s6', 'dep-it', 0, 0, 'in_progress'),
        ]),
      ],
    });
    expect(metrics).toEqual({
      version: 1,
      scope: 'series',
      title: 'Placement 2026',
      maxScore: 8,
      participation: { eligible: 10, finished: 3, inProgress: 0, notStarted: 7, ratePct: 30 },
      statuses: { submitted: 5, autoSubmitted: 0, terminated: 0 },
      scores: {
        mean: 4,
        median: 3,
        top: 7,
        bottom: 2,
        stdDev: 2.16,
        meanPct: 50,
        distribution: [0, 0, 1, 1, 0, 0, 0, 0, 1, 0].map((count, k) => ({
          fromPct: k * 10,
          toPct: k * 10 + 10,
          count,
        })),
      },
      sections: [],
      departments: [
        { departmentId: 'dep-computer', name: 'Computer', finished: 2, mean: 4.5, meanPct: 56.25 },
        { departmentId: 'dep-it', name: 'IT', finished: 1, mean: 3, meanPct: 37.5 },
      ],
      questions: [],
      mostMissed: [],
      mostPickedWrong: [],
      strikes: { total: 0, attemptsWithStrikes: 0, terminated: 0 },
      timeTaken: {
        meanSec: 576,
        medianSec: 600,
        minSec: 300,
        maxSec: 900,
        distribution: [0, 2, 2, 1].map((count, i) => ({ fromMin: i * 5, toMin: i * 5 + 5, count })),
      },
      trends: [
        {
          testId: 't1',
          heading: 'Day 1: Quantitative aptitude',
          date: '2026-11-01',
          finished: 2,
          mean: 3,
          median: 3,
          max: 4,
          meanPct: 75,
        },
        {
          testId: 't2',
          heading: 'Day 2: Logical reasoning',
          date: '2026-11-02',
          finished: 3,
          mean: 2,
          median: 2,
          max: 4,
          meanPct: 50,
        },
      ],
      discriminationGroupPct: 27,
    });
    expect(JSON.stringify(metrics)).not.toMatch(/"s\d"/);
  });

  it('EXP-04 schedule ties, a test not taken counting 0, terminated attempts and the latest department', () => {
    const test = (
      id: string,
      heading: string,
      scheduledDate: string,
      windowStart: number,
      attempts: MetricsAttempt[],
    ) => ({
      id,
      heading,
      scheduledDate,
      windowStart,
      maxScore: 2,
      attempts,
    });
    const metrics = computeSeriesMetrics({
      title: 'Ties',
      eligible: 5,
      departments: DEPARTMENTS,
      tests: [
        test('tb', 'B', '2026-11-03', 100, [
          graded('p', 'dep-computer', 1.5, 60, 'terminated'),
          graded('q', 'dep-it', 2, 60, 'reset'),
          graded('r', 'dep-it', 2, 60),
        ]),
        test('tempty', 'Empty', '2026-11-04', 0, [graded('q', 'dep-it', 1, 60, 'in_progress')]),
        test('ta', 'A', '2026-11-03', 100, [graded('p', 'dep-computer', 0.1, 60)]),
        test('tz', 'Z', '2026-11-03', 50, [graded('p', 'dep-computer', 0.2, 60), graded('r', 'dep-computer', 1, 60)]),
      ],
    });
    expect(metrics.maxScore).toBe(8);
    expect(metrics.trends.map((t) => [t.testId, t.finished, t.mean, t.median, t.max, t.meanPct])).toEqual([
      ['tz', 2, 0.6, 0.6, 2, 30],
      ['ta', 1, 0.1, 0.1, 2, 5],
      ['tb', 2, 1.75, 1.75, 2, 87.5],
    ]);
    // p: 0.2 + 0.1 + 1.5 (terminated, counted) = 1.8; r: 1 + 2 = 3, in IT as on their latest test; q only reset.
    expect(metrics.participation).toEqual({ eligible: 5, finished: 2, inProgress: 0, notStarted: 3, ratePct: 40 });
    expect(metrics.scores).toMatchObject({ mean: 2.4, median: 2.4, top: 3, bottom: 1.8, stdDev: 0.6, meanPct: 30 });
    expect(metrics.statuses).toEqual({ submitted: 4, autoSubmitted: 0, terminated: 1 });
    expect(metrics.strikes).toEqual({ total: 3, attemptsWithStrikes: 1, terminated: 1 });
    expect(metrics.departments).toEqual([
      { departmentId: 'dep-computer', name: 'Computer', finished: 1, mean: 1.8, meanPct: 22.5 },
      { departmentId: 'dep-it', name: 'IT', finished: 1, mean: 3, meanPct: 37.5 },
    ]);
  });
});
