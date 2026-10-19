import { z } from 'zod';

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
