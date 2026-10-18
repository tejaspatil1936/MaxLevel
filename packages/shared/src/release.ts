import { z } from 'zod';
import type { Settings } from './settings';
import type { LeaderboardPayload, TaskRequest } from './tasks';

// Result release (spec 8.1 RES-01, RES-05; 8.2 LB-04; SER-09, DATA-05; docs/testids/phase-4.md "Result release").
// The release setting is the test's resolved `resultRelease`; the test record keeps `resultsReleasedAt` and
// `resultsWithdrawn`. Release rules live only here (spec 9.5).

export const RELEASE_STATES = ['released', 'pending', 'withdrawn', 'never'] as const;
export const releaseStateSchema = z.enum(RELEASE_STATES);
export type ReleaseState = z.infer<typeof releaseStateSchema>;

export interface ReleaseInput {
  settings: Pick<Settings, 'resultRelease' | 'resultDetail' | 'timingMode' | 'window'>;
  resultsReleasedAt?: number | null;
  resultsWithdrawn?: boolean;
}

/**
 * What students see of a test's results (RES-01, RES-05): `never` for a test that never shares them; `withdrawn`
 * while an admin has withdrawn them; `released` always for `immediate`, and for `after_close` and `manual` once
 * `resultsReleasedAt` is set; otherwise `pending`.
 */
export function resultReleaseState(input: ReleaseInput): ReleaseState {
  const mode = input.settings.resultRelease;
  if (mode === 'never') return 'never';
  if (input.resultsWithdrawn === true) return 'withdrawn';
  if (mode === 'immediate') return 'released';
  return typeof input.resultsReleasedAt === 'number' ? 'released' : 'pending';
}

/** The window end has passed (a test without a window counts as closed). */
const windowClosed = (settings: ReleaseInput['settings'], now: number) =>
  !settings.window || now >= settings.window.end;

/** LB-04: released, and in a flexible window only once the window has closed. Leaderboards follow this. */
export function resultsPublic(input: ReleaseInput, now: number): boolean {
  if (resultReleaseState(input) !== 'released') return false;
  return input.settings.timingMode !== 'flexible' || windowClosed(input.settings, now);
}

export type ReleaseRefusal = 'RESULTS_NOT_RELEASABLE' | 'FULL_REVIEW_BEFORE_CLOSE';

/**
 * Why Release results is refused now, or null: a test set to `never`, or a full review in a flexible window that has
 * not closed, since students who haven't started would see the answers (SER-09, DATA-05).
 */
export function manualReleaseRefusal(input: ReleaseInput, now: number): null | ReleaseRefusal {
  const { settings } = input;
  if (settings.resultRelease === 'never') return 'RESULTS_NOT_RELEASABLE';
  if (settings.timingMode === 'flexible' && settings.resultDetail === 'full' && !windowClosed(settings, now))
    return 'FULL_REVIEW_BEFORE_CLOSE';
  return null;
}

export interface ReleaseTaskPayload {
  orgId: string;
  testId: string;
}

/**
 * RES-01: the task that runs at the window end, queued (idempotently by name) at publish and at every attempt start.
 * A moved window end is a new name, so the new end gets a task of its own.
 */
export function releaseResultsTask(input: {
  orgId: string;
  testId: string;
  windowEnd: number;
}): TaskRequest<ReleaseTaskPayload> {
  return {
    name: `release-results-${input.orgId}-${input.testId}-${input.windowEnd}`,
    path: '/tasks/release-results',
    payload: { orgId: input.orgId, testId: input.testId },
    scheduleTime: input.windowEnd,
  };
}

/**
 * What a release task run does on the server clock: nothing before the window end (`early`); at or after it, a
 * leaderboard recompute, and for `after_close` results not yet released or withdrawn also storing
 * `resultsReleasedAt` (`release`). Running it again after a release finds it released, so twice equals once.
 */
export function releaseTaskAction(input: ReleaseInput, now: number): 'early' | 'recompute' | 'release' {
  const { settings } = input;
  if (!settings.window || now < settings.window.end) return 'early';
  const unreleased = typeof input.resultsReleasedAt !== 'number' && input.resultsWithdrawn !== true;
  return settings.resultRelease === 'after_close' && unreleased ? 'release' : 'recompute';
}

/**
 * LB-03: a leaderboard recompute due at once, queued by Release results, Withdraw results and the release task.
 * `key` tells the occasions apart (for the release task, its window end, so a second run queues nothing new).
 */
export function leaderboardRecomputeTask(
  payload: LeaderboardPayload,
  key: string,
  now: number,
): TaskRequest<LeaderboardPayload> {
  return {
    name: `leaderboard-${payload.orgId}-${payload.testId}-${key}`,
    path: '/tasks/leaderboard',
    payload,
    scheduleTime: now,
  };
}

/** `POST /v1/tests/{id}/release`. */
export const releaseResponseSchema = z.object({ resultsReleasedAt: z.number().int().nullable() });
export type ReleaseResponse = z.infer<typeof releaseResponseSchema>;
/** `POST /v1/tests/{id}/withdraw-results`. */
export const withdrawResponseSchema = z.object({ resultsWithdrawn: z.literal(true) });
export type WithdrawResponse = z.infer<typeof withdrawResponseSchema>;
