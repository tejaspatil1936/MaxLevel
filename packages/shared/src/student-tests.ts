import { z } from 'zod';
import { FINISHED_ATTEMPT_STATUSES, isFinishedAttempt, type AttemptStatus } from './attempt';
import { markingSchema, settingsSchema, type Settings } from './settings';
import { canStart } from './timing';

// The student dashboard and test page (US-ST-03, UX-11, spec 7.1). Times are epoch ms (UTC); the client shows them in
// the organization's `timezone`. Nothing here carries an answer key (DATA-05): parsing strips unknown keys.

const ms = z.number().int();

/** Where a test stands for one student at `now`; `null` means the student is not shown the test. */
export type StudentTestState = 'upcoming' | 'live' | 'in_progress' | 'finished';

/**
 * US-ST-03: a finished attempt makes the test finished and one in progress keeps it open to resume; otherwise the test
 * is upcoming before its window, live while an attempt can start (canStart), and not shown once the last start time
 * has passed (a test the student missed) or when it has no window.
 */
export function studentTestState(
  settings: Pick<Settings, 'timingMode' | 'window' | 'durationMin' | 'lateEntryCutoffMin' | 'windowEndPolicy'>,
  now: number,
  attemptStatus?: AttemptStatus,
): StudentTestState | null {
  if (attemptStatus && isFinishedAttempt(attemptStatus)) return 'finished';
  if (attemptStatus === 'in_progress') return 'in_progress';
  if (!settings.window) return null;
  if (now < settings.window.start) return 'upcoming';
  return canStart(settings, now).ok ? 'live' : null;
}

/** A live or upcoming test as the dashboard lists it. The heading is `<dayLabel>: <title>`, or the title alone. */
export const studentTestSummarySchema = z.object({
  testId: z.string(),
  title: z.string(),
  dayLabel: z.string().nullable(),
  company: z.string().optional(),
  window: z.object({ start: ms, end: ms }),
  durationMin: z.number().int(),
  /** Fixed slot: start + late entry cutoff; flexible: window end − duration (full duration) or window end. */
  lastStartAt: ms,
  /** The student's attempt in progress, to resume. */
  attemptId: z.string().optional(),
});
export type StudentTestSummary = z.infer<typeof studentTestSummarySchema>;

export const completedTestSchema = z.object({
  testId: z.string(),
  title: z.string(),
  dayLabel: z.string().nullable(),
  attemptId: z.string(),
  status: z.enum(FINISHED_ATTEMPT_STATUSES),
  /** When it was submitted, or started when no submit time is stored; completed tests are listed newest first. */
  finishedAt: ms,
});
export type CompletedTest = z.infer<typeof completedTestSchema>;

/** GET /v1/student/dashboard: live by last start time, upcoming by window start, completed newest first. */
export const studentDashboardSchema = z.object({
  timezone: z.string(),
  live: z.array(studentTestSummarySchema),
  upcoming: z.array(studentTestSummarySchema),
  completed: z.array(completedTestSchema),
});
export type StudentDashboard = z.infer<typeof studentDashboardSchema>;

/** What the preflight and rules screens need beyond the test page (EX-01, EX-02): the timing mode and the proctoring switches. */
export const examEntrySchema = settingsSchema.pick({
  timingMode: true,
  windowEndPolicy: true,
  fullscreenRequired: true,
  cameraRequired: true,
  secondCamera: true,
});
export type ExamEntry = z.infer<typeof examEntrySchema>;

/** GET /v1/student/tests/{id}: the test page (spec 7.1 step 1), for a test the dashboard would list. */
export const studentTestPageSchema = studentTestSummarySchema.extend({
  timezone: z.string(),
  state: z.enum(['upcoming', 'live', 'in_progress', 'finished']),
  /** The draw size: how many questions each student gets. */
  questionCount: z.number().int(),
  sections: z.array(z.object({ name: z.string(), questionCount: z.number().int() })),
  marking: markingSchema,
  maxStrikes: z.number().int(),
  exam: examEntrySchema,
});
export type StudentTestPage = z.infer<typeof studentTestPageSchema>;
