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
