import { z } from 'zod';
import { attemptStatusSchema } from './attempt';

// The live exam dashboard (spec 8.3, 10.2; OPS-01 to OPS-03, PERF-04; docs/testids/phase-5.md "Live mirror"): the
// compact status record the API mirrors into Realtime Database for each attempt, the live view's API reads, and the
// `Offline for more than 60 s` rule. Rows, counts and sorting are in live-rows.ts. Times are epoch ms (server clock).

const ms = z.number().int();
const id = z.string().min(1).max(128);

/** A row's status, in the order of the counts list (also the `Status` sort order). */
export const LIVE_ROW_STATUSES = [
  'not_started',
  'pairing',
  'in_progress',
  'submitted',
  'auto_submitted',
  'terminated',
] as const;
export type LiveRowStatus = (typeof LIVE_ROW_STATUSES)[number];

/** What a live record's `status` can say: a reservation, an attempt status, or `reset` (never shown). */
export const liveRecordStatusSchema = z.union([z.literal('pairing'), attemptStatusSchema]);
export type LiveRecordStatus = z.infer<typeof liveRecordStatusSchema>;

/** `live/{orgId}/{testId}/{attemptId}` (spec 10.2): written only by the API and worker (DATA-07). */
export const liveRecordSchema = z.object({
  studentId: id,
  name: z.string(),
  prn: z.string(),
  status: liveRecordStatusSchema,
  answered: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
  strikes: z.number().int().min(0).optional(),
  deadlineAt: ms.optional(),
  startedAt: ms.optional(),
  updatedAt: ms,
});
export type LiveRecord = z.infer<typeof liveRecordSchema>;

export const liveTestPath = (orgId: string, testId: string) => `live/${orgId}/${testId}`;
export const liveRecordPath = (orgId: string, testId: string, attemptId: string) =>
  `${liveTestPath(orgId, testId)}/${attemptId}`;
export const presenceTestPath = (orgId: string, testId: string) => `presence/${orgId}/${testId}`;

/** The drawn questions with a saved, non-null answer: the live record's `answered`. */
export function answeredCount(questionIds: string[], answers: Record<string, { optionId: string | null }>): number {
  return questionIds.filter((q) => answers[q] !== undefined && answers[q].optionId !== null).length;
}

// ---------- API ----------

/** GET /v1/live-tests: published tests whose window holds the server's now, earliest start first. */
export const liveTestListSchema = z.object({
  items: z.array(
    z.object({
      testId: id,
      title: z.string(),
      dayLabel: z.string().nullable(),
      seriesId: id,
      seriesTitle: z.string(),
      window: z.object({ start: ms, end: ms }),
    }),
  ),
});
export type LiveTestList = z.infer<typeof liveTestListSchema>;

/** GET /v1/tests/{id}/live: the live view's one API read, the eligible roster (PERF-04). */
export const liveRosterSchema = z.object({
  test: z.object({
    id,
    title: z.string(),
    dayLabel: z.string().nullable(),
    secondCamera: z.boolean(),
    /** The resolved duration (a fixed slot's length), for the extra-time confirmation (OPS-08). */
    durationMin: z.number().int().min(0),
  }),
  students: z.array(z.object({ id, name: z.string(), prn: z.string() })),
});
export type LiveRoster = z.infer<typeof liveRosterSchema>;

/** GET /v1/tests/{id}/attempts: every attempt of the test, `reset` ones included. */
export const testAttemptListSchema = z.object({
  items: z.array(
    z.object({
      id,
      studentId: id,
      status: attemptStatusSchema,
      startedAt: ms,
      deadlineAt: ms,
      extraTimeSec: z.number().int().min(0),
      strikesCount: z.number().int().min(0),
    }),
  ),
});
export type TestAttemptList = z.infer<typeof testAttemptListSchema>;

/** More than this offline is `Offline for more than 60 s` (OPS-03). */
export const OFFLINE_TOO_LONG_MS = 60_000;

/**
 * `Offline for more than 60 s`: an attempt in progress whose laptop is not online, offline with `lastSeen` more than
 * 60 s ago, or with no laptop presence record and started more than 60 s ago.
 */
export function isOfflineTooLong(input: {
  status: LiveRowStatus;
  laptop?: { online: boolean; lastSeen: number } | null;
  startedAt?: number;
  now: number;
}): boolean {
  if (input.status !== 'in_progress') return false;
  if (input.laptop) return !input.laptop.online && input.now - input.laptop.lastSeen > OFFLINE_TOO_LONG_MS;
  return input.startedAt !== undefined && input.now - input.startedAt > OFFLINE_TOO_LONG_MS;
}
