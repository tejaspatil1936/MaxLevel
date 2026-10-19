import { liveRecordPath, type AttemptRecord, type LiveRecord } from '@mitaoe/shared';
import type { Database } from 'firebase-admin/database';
import { fireAndForget, type WarnLogger } from './rtdb-writes';

/** The student fields a live record names. */
export interface LiveStudent {
  id: string;
  name?: string | null;
  prn?: string | null;
}

/** The live record of an attempt that just started (OPS-02): every field, written with the attempt's owner. */
export function startedRecord(attempt: AttemptRecord, student: LiveStudent, now: number): LiveRecord {
  return {
    studentId: student.id,
    name: student.name ?? '',
    prn: student.prn ?? '',
    status: attempt.status,
    answered: 0,
    total: attempt.draw.questionIds.length,
    strikes: attempt.strikesCount,
    deadlineAt: attempt.deadlineAt,
    startedAt: attempt.startedAt,
    updatedAt: now,
  };
}

/**
 * The live mirror (spec 10.2, OPS-02, DATA-07): the API keeps `live/{orgId}/{testId}/{attemptId}` up to date on a
 * reservation, a start, every answer batch, every counted strike and every finish, so the admin's live view follows
 * the test from Realtime Database alone (PERF-04). Writes are fire and forget (REL-05): a failure is logged and the
 * route replies anyway.
 */
export function liveMirror(rtdb: Database, log: WarnLogger) {
  const update = (
    orgId: string,
    testId: string,
    attemptId: string,
    fields: Partial<LiveRecord> & { backlog?: number },
  ) => {
    const path = liveRecordPath(orgId, testId, attemptId);
    fireAndForget(rtdb.ref(path).update(fields), log, path);
  };
  return {
    /** A pairing reservation before Start (PR-13): the student shows as `pairing`. */
    reserved(orgId: string, testId: string, attemptId: string, student: LiveStudent, now: number): void {
      const path = liveRecordPath(orgId, testId, attemptId);
      const record: LiveRecord = {
        studentId: student.id,
        name: student.name ?? '',
        prn: student.prn ?? '',
        status: 'pairing',
        updatedAt: now,
      };
      fireAndForget(rtdb.ref(path).set(record), log, path);
    },

    /** An answer batch: the answered count after it, and the client's unsynced backlog (OBS-03). */
    answered(orgId: string, attempt: AttemptRecord, answered: number, backlog: number, now: number): void {
      update(orgId, attempt.testId, attempt.id, { answered, backlog, updatedAt: now });
    },

    /** A counted strike (PR-07). */
    strikes(orgId: string, attempt: AttemptRecord, now: number): void {
      update(orgId, attempt.testId, attempt.id, { strikes: attempt.strikesCount, updatedAt: now });
    },

    /** Any finish: submit, time up, strike termination (EX-15 to EX-17, PR-10). */
    finished(orgId: string, attempt: AttemptRecord, now: number): void {
      update(orgId, attempt.testId, attempt.id, {
        status: attempt.status,
        strikes: attempt.strikesCount,
        ...(attempt.result ? { answered: attempt.draw.questionIds.length - attempt.result.unanswered } : {}),
        updatedAt: now,
      });
    },
  };
}
export type LiveMirror = ReturnType<typeof liveMirror>;
