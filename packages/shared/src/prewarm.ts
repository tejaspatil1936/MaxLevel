import type { TaskRequest } from './tasks';

// Pre-warming before an exam slot (spec 9.6, 12.3; PERF-06, REL-04; docs/testids/phase-5.md "Pre-warming"): publishing
// queues one task per slot that raises the API's minimum instances 30 minutes before the window opens, sized by the
// number of eligible students. Times are epoch ms on the Clock.

/** PERF-06: minimum instances rise this long before each slot. */
export const PREWARM_LEAD_MS = 30 * 60_000;
/** Spec 9.6: the API's usual minimum and its maximum instances. */
export const API_MIN_INSTANCES = 2;
export const API_MAX_INSTANCES = 20;
/** Eligible students per API instance on exam days; calibrated by the PERF-07 load test (spec 9.6, 12.4). */
export const STUDENTS_PER_INSTANCE = 100;

export interface PrewarmPayload {
  orgId: string;
  testId: string;
  windowStart: number;
}

/**
 * The pre-warm task of one slot, at window start − 30 minutes, or now when that has passed. The name carries the
 * window start, so a test published again for another slot (a moved date) gets a task of its own.
 */
export function prewarmTask(input: PrewarmPayload, now: number): TaskRequest<PrewarmPayload> {
  const { orgId, testId, windowStart } = input;
  return {
    name: `prewarm-${orgId}-${testId}-${windowStart}`,
    path: '/tasks/prewarm',
    payload: { orgId, testId, windowStart },
    scheduleTime: Math.max(now, windowStart - PREWARM_LEAD_MS),
  };
}

/** The API minimum instances for a slot: one per 100 eligible students, never below the usual 2 nor above 20. */
export function prewarmMinInstances(eligibleStudents: number): number {
  const wanted = Math.ceil(Math.max(0, eligibleStudents) / STUDENTS_PER_INSTANCE);
  return Math.min(API_MAX_INSTANCES, Math.max(API_MIN_INSTANCES, wanted));
}

/** What the worker knows of the test a pre-warm task names. */
export interface PrewarmTarget {
  status: string;
  window: { start: number; end: number } | null;
  /** The window start of the last pre-warm that ran for this test. */
  prewarmedFor: number | null;
}

/**
 * Decides a pre-warm run on the server clock (REL-04): `skip` when the test is gone, unpublished, rescheduled to
 * another window start, or its window has ended (a cancelled slot); `done` when this slot was already pre-warmed (a
 * retry or a second run); otherwise `raise`.
 */
export function prewarmAction(
  target: PrewarmTarget | null,
  windowStart: number,
  now: number,
): 'skip' | 'done' | 'raise' {
  const published = target && ['scheduled', 'live', 'closed'].includes(target.status);
  if (!published || !target.window || target.window.start !== windowStart || now >= target.window.end) return 'skip';
  return target.prewarmedFor === windowStart ? 'done' : 'raise';
}
