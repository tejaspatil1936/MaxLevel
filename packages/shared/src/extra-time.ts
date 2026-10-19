import { z } from 'zod';

// Extra time during an attempt (spec 8.4, 11.3; OPS-06, OPS-08, OPS-09; docs/testids/phase-5.md "Extra time"): an
// admin's grant adds whole minutes to the attempt's deadline, which may pass the window end. The API stores it with
// its audit entry, mirrors the new deadline to the live record and pushes it to the student through their signal.

/** The largest grant, in minutes (one day). */
export const MAX_EXTRA_MINUTES = 1440;

/** OPS-08: a grant of more minutes than the test's duration needs a second confirmation. */
export function extraTimeNeedsConfirmation(minutes: number, durationMin: number): boolean {
  return minutes > durationMin;
}

/** The student's notice after a grant: `Your time was extended by 10 minutes.` (`1 minute` for one). */
export function extensionNotice(minutes: number): string {
  return `Your time was extended by ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** Whether a typed amount is a whole number of minutes from 1 to 1,440. */
export const isGrantMinutes = (minutes: number) =>
  Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_EXTRA_MINUTES;

/** POST /v1/attempts/{id}/extra-time: whole minutes and a reason that is not blank. */
export const extraTimeGrantSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_EXTRA_MINUTES),
  reason: z.string().trim().min(1).max(500),
  /** OPS-08: true once the admin confirmed a grant above the test's duration. */
  confirmOverDuration: z.boolean().optional(),
});
export type ExtraTimeGrant = z.infer<typeof extraTimeGrantSchema>;

/** The attempt after the grant: the new deadline and all extra time so far. */
export const extraTimeResultSchema = z.object({
  deadlineAt: z.number().int(),
  extraTimeSec: z.number().int().min(0),
});
export type ExtraTimeResult = z.infer<typeof extraTimeResultSchema>;

/** `signals/{orgId}/{attemptId}` (spec 10.2): written only by the API; the student reads their own (DATA-10). */
export const signalRecordSchema = z.object({ deadlineAt: z.number().int(), notice: z.string() });
export type SignalRecord = z.infer<typeof signalRecordSchema>;
export const signalPath = (orgId: string, attemptId: string) => `signals/${orgId}/${attemptId}`;
