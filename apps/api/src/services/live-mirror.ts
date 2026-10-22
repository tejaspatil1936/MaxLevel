import {
  liveRecordPath,
  proctorPath,
  signalPath,
  type AttemptRecord,
  type LiveRecord,
  type SignalRecord,
} from '@mitaoe/shared';
import type { Database } from 'firebase-admin/database';
import { fireAndForget, withinLimit, type WarnLogger } from './rtdb-writes';

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
 * reservation, a start, every answer batch, every counted strike, every finish, every extra-time grant, a
 * reinstatement and a reset, so the admin's live view follows
 * the test from Realtime Database alone (PERF-04). Writes are fire and forget (REL-05): a failure is logged and the
 * route replies anyway.
 */
export function liveMirror(rtdb: Database, log: WarnLogger) {
  /** Updates the live record; a new `status` also goes to the attempt's proctor record, which its phone follows. */
  const update = (
    orgId: string,
    testId: string,
    attemptId: string,
    fields: Partial<LiveRecord> & { backlog?: number },
    status?: string,
  ) => {
    const path = liveRecordPath(orgId, testId, attemptId);
    const write =
      status === undefined
        ? rtdb.ref(path).update(fields)
        : rtdb.ref().update({
            ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`${path}/${key}`, value])),
            [`${proctorPath(orgId, attemptId)}/status`]: status,
          });
    fireAndForget(write, log, path);
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
      update(
        orgId,
        attempt.testId,
        attempt.id,
        {
          status: attempt.status,
          strikes: attempt.strikesCount,
          ...(attempt.result ? { answered: attempt.draw.questionIds.length - attempt.result.unanswered } : {}),
          updatedAt: now,
        },
        attempt.status,
      );
    },

    /** A reinstated attempt (OPS-04): in progress again, with its answers, strikes and deadline. */
    reinstated(orgId: string, attempt: AttemptRecord, now: number): void {
      update(
        orgId,
        attempt.testId,
        attempt.id,
        { status: attempt.status, strikes: attempt.strikesCount, deadlineAt: attempt.deadlineAt, updatedAt: now },
        attempt.status,
      );
    },

    /** A reset (OPS-10): the record is kept as `reset`, which the live view never shows. */
    reset(orgId: string, attempt: AttemptRecord, now: number): void {
      update(orgId, attempt.testId, attempt.id, { status: 'reset', updatedAt: now }, 'reset');
    },

    /**
     * Extra time (OPS-06, spec 11.3): the live record's new `deadlineAt` and the student's signal, in one write. The
     * route waits a bounded time for it (REL-05), so the student's timer usually follows before the admin sees the
     * reply; resolves false when the write failed or was still pending at the limit (it was logged).
     */
    extended(orgId: string, attempt: AttemptRecord, notice: string, now: number): Promise<boolean> {
      const live = liveRecordPath(orgId, attempt.testId, attempt.id);
      const signal: SignalRecord = { deadlineAt: attempt.deadlineAt, notice };
      const write = rtdb.ref().update({
        [`${live}/deadlineAt`]: attempt.deadlineAt,
        [`${live}/updatedAt`]: now,
        [signalPath(orgId, attempt.id)]: signal,
      });
      return withinLimit(write, log, signalPath(orgId, attempt.id));
    },
  };
}
export type LiveMirror = ReturnType<typeof liveMirror>;
