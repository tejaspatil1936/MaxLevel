import { z } from 'zod';
import { FINISHED_ATTEMPT_STATUSES, isFinishedAttempt, type AttemptStatus } from './attempt';
import { dayLabels, type DayLabelTest } from './day-labels';
import { resultReleaseState, type ReleaseInput } from './release';
import type { Settings } from './settings';

// The student's history (spec 8.1 RES-04, US-ST-08; docs/testids/phase-4.md "History"): every finished attempt by
// series and day, with the score only where the release state and Show past scores allow it. Show past scores
// affects only the history (DECISIONS 2026-10-18). Nothing here carries an answer key (DATA-05).

/** `shown` and `hidden` for released results (Show past scores on or off); otherwise the release state. */
export const HISTORY_SCORE_STATES = ['shown', 'hidden', 'pending', 'withdrawn', 'never'] as const;
export type HistoryScoreState = (typeof HISTORY_SCORE_STATES)[number];

const historyTestShape = z.object({
  testId: z.string(),
  title: z.string(),
  dayLabel: z.string().nullable(),
  scheduledDate: z.string(),
  attemptId: z.string(),
  status: z.enum(FINISHED_ATTEMPT_STATUSES),
  scoreState: z.enum(HISTORY_SCORE_STATES),
  score: z.number().optional(),
  max: z.number().optional(),
});
export type HistoryTest = z.infer<typeof historyTestShape>;

/** One history row; the refinement refuses a score unless it may be shown, so a bug fails the request (RES-04). */
export const historyTestSchema = historyTestShape.superRefine((r, ctx) => {
  if (r.scoreState === 'shown') return;
  for (const key of ['score', 'max'] as const)
    if (r[key] !== undefined)
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not sent while the score is ${r.scoreState}.` });
});

/** `GET /v1/student/history`. */
export const studentHistorySchema = z.object({
  series: z.array(z.object({ id: z.string(), title: z.string(), tests: z.array(historyTestSchema) })),
});
export type StudentHistory = z.infer<typeof studentHistorySchema>;

/** RES-04: what the history shows of a test's score. A test with no settings snapshot shows nothing yet. */
export function historyScoreState(
  settings: Settings | null,
  release: Omit<ReleaseInput, 'settings'>,
): HistoryScoreState {
  if (!settings) return 'pending';
  const state = resultReleaseState({ settings, ...release });
  if (state !== 'released') return state;
  return settings.showPastScores ? 'shown' : 'hidden';
}

export interface HistoryInput {
  /** The student's own attempts in their organization, any status. */
  attempts: ReadonlyArray<{
    id: string;
    testId: string;
    status: AttemptStatus;
    score: number | null;
    max: number | null;
  }>;
  /** The series holding those tests, each with all its tests (day labels count every test of the series). */
  series: ReadonlyArray<{
    id: string;
    title: string;
    startDate: string;
    tests: ReadonlyArray<
      DayLabelTest & {
        title: string;
        settings: Settings | null;
        resultsReleasedAt?: number | null;
        resultsWithdrawn?: boolean;
      }
    >;
  }>;
}

/**
 * US-ST-08, RES-04: every finished attempt (not in progress or reset), grouped by series with the newest start date
 * first, tests in scheduled order (date, then day order); series without one are left out. The score and its maximum
 * are present only when `scoreState` is `shown`.
 */
export function studentHistory(input: HistoryInput): StudentHistory {
  const byTest = new Map<string, HistoryInput['attempts'][number][]>();
  for (const a of input.attempts) {
    if (!isFinishedAttempt(a.status)) continue;
    byTest.set(a.testId, [...(byTest.get(a.testId) ?? []), a]);
  }
  const series = [...input.series]
    .sort(
      (a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    )
    .map((s) => {
      const labels = dayLabels(s.tests);
      const ordered = s.tests
        .map((test, i) => ({ test, i }))
        .sort((a, b) => a.test.scheduledDate.localeCompare(b.test.scheduledDate) || a.i - b.i);
      const tests = ordered.flatMap(({ test }) =>
        (byTest.get(test.id) ?? []).map((a): HistoryTest => {
          const scoreState = historyScoreState(test.settings, {
            resultsReleasedAt: test.resultsReleasedAt ?? null,
            resultsWithdrawn: test.resultsWithdrawn === true,
          });
          const shown = scoreState === 'shown' && a.score !== null && a.max !== null;
          return {
            testId: test.id,
            title: test.title,
            dayLabel: labels[test.id] ?? null,
            scheduledDate: test.scheduledDate,
            attemptId: a.id,
            status: a.status as HistoryTest['status'],
            scoreState: scoreState === 'shown' && !shown ? 'pending' : scoreState,
            ...(shown ? { score: a.score!, max: a.max! } : {}),
          };
        }),
      );
      return { id: s.id, title: s.title, tests };
    });
  return { series: series.filter((s) => s.tests.length > 0) };
}
