import { z } from 'zod';
import { LATE_SYNC_GRACE_MS } from './sync';

// Background work (PLAN section 3, TEST_ENV "Cloud Tasks"). Domain code enqueues through TaskQueue only: Cloud Tasks in
// production, a Firestore-backed local queue in development and tests. Times are epoch ms on the Clock.

export const TASK_PATHS = [
  '/tasks/auto-submit',
  '/tasks/release-results',
  '/tasks/leaderboard',
  '/tasks/import',
  '/tasks/report',
  '/tasks/export',
  '/tasks/prewarm',
  '/tasks/migrate',
] as const;
export type TaskPath = (typeof TASK_PATHS)[number];

export interface TaskRequest<P = unknown> {
  /** Deterministic, so enqueueing the same work twice stores one task. */
  name: string;
  path: TaskPath;
  payload: P;
  /** When the task may run; omitted means now. */
  scheduleTime?: number;
}

export interface TaskQueue {
  /** Stores the task once; a task with the same name already queued is left as it is. */
  enqueue(task: TaskRequest): Promise<void>;
}

/** A queued task as the test-only API lists it (GET /__test/tasks). */
export const pendingTaskSchema = z.object({ name: z.string(), path: z.string(), scheduleTime: z.number().int() });
export type PendingTask = z.infer<typeof pendingTaskSchema>;

export interface AutoSubmitPayload {
  orgId: string;
  attemptId: string;
  deadlineAt: number;
}

/**
 * EX-16, DECISIONS Q18: the task that finalizes an attempt nobody submitted, 2 minutes after its deadline (the late
 * sync grace). The name carries the deadline, so a later deadline (extra time) gets a task of its own.
 */
export function autoSubmitTask(orgId: string, attemptId: string, deadlineAt: number): TaskRequest<AutoSubmitPayload> {
  return {
    name: `auto-submit-${attemptId}-${deadlineAt}`,
    path: '/tasks/auto-submit',
    payload: { orgId, attemptId, deadlineAt },
    scheduleTime: deadlineAt + LATE_SYNC_GRACE_MS,
  };
}

/** What the auto-submit task does with the attempt it names (EX-16, REL-04). */
export type AutoSubmitAction = 'skip' | 'finalize' | 'reschedule' | 'retry';

/**
 * Decides an auto-submit run on the server clock: nothing for a missing or finished attempt (so a retry or a second
 * run changes nothing); finalize once the late sync grace after the stored deadline has passed; otherwise the deadline
 * moved later than the task was made for (extra time), so a task for the new deadline is queued, or, for the same
 * deadline, the run came early and is retried.
 */
export function autoSubmitAction(
  attempt: { status: string; deadlineAt: number } | null,
  taskDeadlineAt: number | undefined,
  now: number,
): AutoSubmitAction {
  if (!attempt || attempt.status !== 'in_progress') return 'skip';
  if (now >= attempt.deadlineAt + LATE_SYNC_GRACE_MS) return 'finalize';
  return taskDeadlineAt === attempt.deadlineAt ? 'retry' : 'reschedule';
}

/** Leaderboards are recomputed at most every 30 seconds while submissions arrive (LB-03). */
export const LEADERBOARD_DEBOUNCE_MS = 30_000;

export interface LeaderboardPayload {
  orgId: string;
  testId: string;
  seriesId: string;
}

/**
 * EX-17, LB-03: the recompute queued by each graded attempt. Submissions in the same 30-second slot share one task
 * (same name), which runs when the slot ends, so it sees all of them.
 */
export function leaderboardTask(
  orgId: string,
  testId: string,
  seriesId: string,
  now: number,
): TaskRequest<LeaderboardPayload> {
  const slot = Math.floor(now / LEADERBOARD_DEBOUNCE_MS);
  return {
    name: `leaderboard-${orgId}-${testId}-${slot}`,
    path: '/tasks/leaderboard',
    payload: { orgId, testId, seriesId },
    scheduleTime: (slot + 1) * LEADERBOARD_DEBOUNCE_MS,
  };
}
