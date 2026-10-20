import { z } from 'zod';
import { isFinishedAttempt, type AttemptStatus } from './attempt';

// Analytics report metrics (spec EXP-04, docs/testids/phase-7.md "Metrics"). Every number of a report is computed
// here (spec 9.5); the model only writes the narrative. The metrics hold counts, scores, rates and labels: no
// student ID, name, email or PRN. Every non-integer number is rounded to 2 decimal places.

/** Top and bottom groups of the discrimination index, per cent of the attempts served the question. */
export const DISCRIMINATION_GROUP_PCT = 27;

const num = z.number();
const count = z.number().int().min(0);

export const reportMetricsSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['test', 'series']),
  title: z.string(),
  maxScore: num,
  participation: z.object({
    eligible: count,
    finished: count,
    inProgress: count,
    notStarted: count,
    ratePct: num,
  }),
  statuses: z.object({ submitted: count, autoSubmitted: count, terminated: count }),
  scores: z.object({
    mean: num,
    median: num,
    top: num,
    bottom: num,
    stdDev: num,
    meanPct: num,
    distribution: z.array(z.object({ fromPct: num, toPct: num, count })),
  }),
  sections: z.array(z.object({ sectionId: z.string(), name: z.string(), max: num, mean: num, meanPct: num })),
  departments: z.array(
    z.object({ departmentId: z.string(), name: z.string(), finished: count, mean: num, meanPct: num }),
  ),
  questions: z.array(
    z.object({
      number: z.number().int().min(1),
      questionId: z.string(),
      sectionName: z.string().nullable(),
      served: count,
      answered: count,
      correct: count,
      correctRatePct: num,
      discriminationIndex: num.nullable(),
      wrongPicks: z.array(z.object({ letter: z.string(), text: z.string(), count })),
    }),
  ),
  mostMissed: z.array(z.object({ number: z.number().int().min(1), correctRatePct: num })),
  mostPickedWrong: z.array(z.object({ number: z.number().int().min(1), letter: z.string(), text: z.string(), count })),
  strikes: z.object({ total: count, attemptsWithStrikes: count, terminated: count }),
  timeTaken: z.object({
    meanSec: num,
    medianSec: num,
    minSec: num,
    maxSec: num,
    distribution: z.array(z.object({ fromMin: count, toMin: count, count })),
  }),
  trends: z.array(
    z.object({
      testId: z.string(),
      heading: z.string(),
      date: z.string(),
      finished: count,
      mean: num,
      median: num,
      max: num,
      meanPct: num,
    }),
  ),
  discriminationGroupPct: z.literal(DISCRIMINATION_GROUP_PCT),
});
export type ReportMetrics = z.infer<typeof reportMetricsSchema>;

/** Rounds to 2 decimal places (after dropping floating-point noise, so 1.005 stays 1.01 and -0 is 0). */
export const round2 = (n: number) => Math.round(Math.round(n * 1e6) / 1e4) / 100 + 0;

/** Drops floating-point noise from sums of fractional marks (0.1 + 0.2), to 6 decimal places, as scoring does. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0);
const mean = (values: ReadonlyArray<number>) => (values.length ? sum(values) / values.length : 0);
/** `part / whole × 100`, 0 when the whole is 0. */
const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** The middle value; of an even count, the mean of the two middle values; 0 for none. */
export function median(values: ReadonlyArray<number>): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Population standard deviation; 0 for none. */
function stdDev(values: ReadonlyArray<number>): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Top 27% against bottom 27%: the rows sorted by score descending, ties by student ID ascending; k = ceil(0.27 n);
 * (correct in the first k − correct in the last k) / k, rounded to 2 decimals. Null below 2 rows.
 */
export function discriminationIndex(
  rows: ReadonlyArray<{ studentId: string; score: number; correct: boolean }>,
): number | null {
  const n = rows.length;
  if (n < 2) return null;
  const sorted = [...rows].sort(
    (a, b) => b.score - a.score || (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0),
  );
  // Integer arithmetic: 0.27 × 100 is 27.000000000000004 in floating point, whose ceiling would be 28.
  const k = Math.ceil((DISCRIMINATION_GROUP_PCT * n) / 100);
  const correctIn = (group: typeof sorted) => group.filter((r) => r.correct).length;
  return round2((correctIn(sorted.slice(0, k)) - correctIn(sorted.slice(n - k))) / k);
}

/** Mean, median, extremes, population standard deviation and mean per cent of a set of scores, rounded. */
export function scoreSummary(
  values: ReadonlyArray<number>,
  max: number,
): Omit<ReportMetrics['scores'], 'distribution'> {
  const m = mean(values);
  return {
    mean: round2(m),
    median: round2(median(values)),
    top: values.length ? round2(Math.max(...values)) : 0,
    bottom: values.length ? round2(Math.min(...values)) : 0,
    stdDev: round2(stdDev(values)),
    meanPct: round2(pctOf(m, max)),
  };
}

/**
 * Ten bands of score per cent: band k holds 10k (inclusive) to 10k + 10 (exclusive); the last also holds 100. Scores
 * below 0 fall in the first band, above the maximum in the last.
 */
export function scoreDistribution(values: ReadonlyArray<number>, max: number): ReportMetrics['scores']['distribution'] {
  const bands = Array.from({ length: 10 }, (_, k) => ({ fromPct: k * 10, toPct: k * 10 + 10, count: 0 }));
  for (const v of values) {
    const pct = Math.round(pctOf(v, max) * 1e6) / 1e6;
    bands[Math.min(9, Math.max(0, Math.floor(pct / 10)))]!.count += 1;
  }
  return bands;
}

/** Five-minute bands of time taken from 0 up to the band of the longest time; none for no attempts. */
export function timeDistribution(durations: ReadonlyArray<number>): ReportMetrics['timeTaken']['distribution'] {
  if (!durations.length) return [];
  const bandOf = (sec: number) => Math.max(0, Math.floor(sec / 300));
  const bands = Array.from({ length: bandOf(Math.max(...durations)) + 1 }, (_, i) => ({
    fromMin: i * 5,
    toMin: i * 5 + 5,
    count: 0,
  }));
  for (const d of durations) bands[bandOf(d)]!.count += 1;
  return bands;
}

/** Mean, median and extremes of the time taken in seconds, with its 5-minute bands. */
export function timeTaken(durations: ReadonlyArray<number>): ReportMetrics['timeTaken'] {
  return {
    meanSec: round2(mean(durations)),
    medianSec: round2(median(durations)),
    minSec: durations.length ? Math.min(...durations) : 0,
    maxSec: durations.length ? Math.max(...durations) : 0,
    distribution: timeDistribution(durations),
  };
}

/** A finished attempt as the metrics read it (built from the stored attempt, its draw, answers and result). */
export interface MetricsAttempt {
  studentId: string;
  departmentId: string | null;
  status: 'submitted' | 'auto_submitted' | 'terminated';
  score: number;
  durationSec: number;
  strikesCount: number;
  sections: Record<string, { score: number }>;
  /** questionId → chosen option ID; only questions of the draw. */
  answers: Record<string, string | null>;
  drawQuestionIds: string[];
}

type Department = { id: string; name: string };

/** Finished attempts only: terminated ones are graded and counted (spec 15.3); reset and in-progress ones are not. */
const finishedOnly = (attempts: ReadonlyArray<MetricsAttempt>) =>
  attempts.filter((a) => isFinishedAttempt(a.status as AttemptStatus));

/** Departments with at least one entry, in the organization's order, each with its count and mean score. */
function departmentRows(
  departments: ReadonlyArray<Department>,
  entries: ReadonlyArray<{ departmentId: string | null; score: number }>,
  max: number,
): ReportMetrics['departments'] {
  return departments.flatMap((d) => {
    const scores = entries.filter((e) => e.departmentId === d.id).map((e) => e.score);
    if (!scores.length) return [];
    const m = mean(scores);
    return [
      { departmentId: d.id, name: d.name, finished: scores.length, mean: round2(m), meanPct: round2(pctOf(m, max)) },
    ];
  });
}

/** Statuses, strikes and time taken over finished attempts. */
function attemptFigures(attempts: ReadonlyArray<MetricsAttempt>) {
  const counted = (status: MetricsAttempt['status']) => attempts.filter((a) => a.status === status).length;
  return {
    statuses: {
      submitted: counted('submitted'),
      autoSubmitted: counted('auto_submitted'),
      terminated: counted('terminated'),
    },
    strikes: {
      total: sum(attempts.map((a) => a.strikesCount)),
      attemptsWithStrikes: attempts.filter((a) => a.strikesCount > 0).length,
      terminated: counted('terminated'),
    },
    timeTaken: timeTaken(attempts.map((a) => a.durationSec)),
  };
}

function participation(eligible: number, finished: number, inProgress: number): ReportMetrics['participation'] {
  return {
    eligible,
    finished,
    inProgress,
    notStarted: Math.max(0, eligible - finished - inProgress),
    ratePct: round2(pctOf(finished, eligible)),
  };
}

const letterOf = (index: number) => String.fromCharCode(65 + index);

/** EXP-04: the statistics of one test from its finished attempts. */
export function computeTestMetrics(input: {
  title: string;
  maxScore: number;
  eligible: number;
  inProgress: number;
  questions: ReadonlyArray<{
    id: string;
    sectionId: string | null;
    options: ReadonlyArray<{ id: string; text: string }>;
    correctOptionIds: ReadonlyArray<string>;
  }>;
  sections: ReadonlyArray<{ id: string; name: string; max: number }>;
  departments: ReadonlyArray<Department>;
  attempts: ReadonlyArray<MetricsAttempt>;
}): ReportMetrics {
  const attempts = finishedOnly(input.attempts);
  const scores = attempts.map((a) => a.score);
  const draws = attempts.map((a) => ({ attempt: a, drawn: new Set(a.drawQuestionIds) }));
  const sectionNames = new Map(input.sections.map((s) => [s.id, s.name]));

  const questions = input.questions.map((q, i) => {
    const isCorrect = (pick: string | null) => pick !== null && q.correctOptionIds.includes(pick);
    const served = draws
      .filter((d) => d.drawn.has(q.id))
      .map(({ attempt }) => ({ attempt, pick: attempt.answers[q.id] ?? null }));
    const correct = served.filter((s) => isCorrect(s.pick)).length;
    return {
      number: i + 1,
      questionId: q.id,
      sectionName: q.sectionId === null ? null : (sectionNames.get(q.sectionId) ?? null),
      served: served.length,
      answered: served.filter((s) => s.pick !== null).length,
      correct,
      correctRatePct: round2(pctOf(correct, served.length)),
      discriminationIndex: discriminationIndex(
        served.map((s) => ({ studentId: s.attempt.studentId, score: s.attempt.score, correct: isCorrect(s.pick) })),
      ),
      wrongPicks: q.options.flatMap((o, j) => {
        const picked = served.filter((s) => s.pick === o.id).length;
        return picked > 0 && !isCorrect(o.id) ? [{ letter: letterOf(j), text: o.text, count: picked }] : [];
      }),
    };
  });

  const mostMissed = questions
    .filter((q) => q.served > 0)
    .sort((a, b) => a.correctRatePct - b.correctRatePct || a.number - b.number)
    .slice(0, 5)
    .map((q) => ({ number: q.number, correctRatePct: q.correctRatePct }));
  const mostPickedWrong = questions
    .flatMap((q) => q.wrongPicks.map((w) => ({ number: q.number, ...w })))
    .sort((a, b) => b.count - a.count || a.number - b.number || (a.letter < b.letter ? -1 : 1))
    .slice(0, 5);

  return {
    version: 1,
    scope: 'test',
    title: input.title,
    maxScore: input.maxScore,
    participation: participation(input.eligible, attempts.length, input.inProgress),
    scores: { ...scoreSummary(scores, input.maxScore), distribution: scoreDistribution(scores, input.maxScore) },
    sections: input.sections.map((s) => {
      const m = mean(attempts.map((a) => a.sections[s.id]?.score ?? 0));
      return { sectionId: s.id, name: s.name, max: s.max, mean: round2(m), meanPct: round2(pctOf(m, s.max)) };
    }),
    departments: departmentRows(input.departments, attempts, input.maxScore),
    questions,
    mostMissed,
    mostPickedWrong,
    ...attemptFigures(attempts),
    trends: [],
    discriminationGroupPct: DISCRIMINATION_GROUP_PCT,
  };
}

/** Schedule order: scheduled date, then window start, then heading. */
const bySchedule = (
  a: { scheduledDate: string; windowStart: number; heading: string },
  b: { scheduledDate: string; windowStart: number; heading: string },
) =>
  a.scheduledDate.localeCompare(b.scheduledDate) ||
  a.windowStart - b.windowStart ||
  (a.heading < b.heading ? -1 : a.heading > b.heading ? 1 : 0);

/**
 * EXP-04: the statistics of a series from its published tests. A student's total is the sum of their finished
 * attempts' scores (a test not taken counts 0, as LB-02); students with no finished attempt are left out. A student's
 * department is the one on their latest test in schedule order. Per-question parts and sections are empty.
 */
export function computeSeriesMetrics(input: {
  title: string;
  eligible: number;
  departments: ReadonlyArray<Department>;
  tests: ReadonlyArray<{
    id: string;
    heading: string;
    scheduledDate: string;
    windowStart: number;
    maxScore: number;
    attempts: ReadonlyArray<MetricsAttempt>;
  }>;
}): ReportMetrics {
  const tests = [...input.tests].sort(bySchedule).map((t) => ({ ...t, attempts: finishedOnly(t.attempts) }));
  const maxScore = tidy(sum(tests.map((t) => t.maxScore)));
  const students = new Map<string, { departmentId: string | null; score: number }>();
  for (const a of tests.flatMap((t) => t.attempts)) {
    const acc = students.get(a.studentId) ?? { departmentId: null, score: 0 };
    students.set(a.studentId, { departmentId: a.departmentId ?? acc.departmentId, score: tidy(acc.score + a.score) });
  }
  const totals = [...students.values()].map((s) => s.score);

  return {
    version: 1,
    scope: 'series',
    title: input.title,
    maxScore,
    participation: participation(input.eligible, students.size, 0),
    scores: { ...scoreSummary(totals, maxScore), distribution: scoreDistribution(totals, maxScore) },
    sections: [],
    departments: departmentRows(input.departments, [...students.values()], maxScore),
    questions: [],
    mostMissed: [],
    mostPickedWrong: [],
    ...attemptFigures(tests.flatMap((t) => t.attempts)),
    trends: tests
      .filter((t) => t.attempts.length > 0)
      .map((t) => {
        const scores = t.attempts.map((a) => a.score);
        const m = mean(scores);
        return {
          testId: t.id,
          heading: t.heading,
          date: t.scheduledDate,
          finished: scores.length,
          mean: round2(m),
          median: round2(median(scores)),
          max: t.maxScore,
          meanPct: round2(pctOf(m, t.maxScore)),
        };
      }),
    discriminationGroupPct: DISCRIMINATION_GROUP_PCT,
  };
}
