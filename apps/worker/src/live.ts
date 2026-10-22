import { liveRecordPath, proctorPath, type AttemptRecord, type ServerStrike } from '@mitaoe/shared';
import { getApps } from 'firebase-admin/app';
import { getDatabaseWithUrl, type Database } from 'firebase-admin/database';
import { initFirestore } from './firebase';

/**
 * What the worker writes to Realtime Database (spec 10.2): the live record of an attempt it finished or struck
 * (OPS-02), and the attempt's proctor record, which its laptop and phone follow.
 */
export interface LiveMirror {
  finished(orgId: string, attempt: AttemptRecord, now: number): Promise<void>;
  strikes(orgId: string, attempt: AttemptRecord, now: number): Promise<void>;
  /** A strike the worker decided, for the attempt's laptop to show (PR-09). */
  serverStrike(orgId: string, attemptId: string, strike: ServerStrike): Promise<void>;
}

/** Reads of the presence records the worker judges (PR-16). */
export interface PresenceReader {
  read(path: string): Promise<unknown>;
}

/**
 * The Admin SDK waits for its connection forever, so each read gets `limitMs` and then fails: the task answers with an
 * error and the queue tries again later, so our own outage never decides a strike (REL-05).
 */
export function presenceReader(rtdb: Database, limitMs = 5_000): PresenceReader {
  return {
    async read(path) {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Realtime Database read of ${path} took over ${limitMs} ms`)),
          limitMs,
        );
        timer.unref();
      });
      try {
        return (await Promise.race([rtdb.ref(path).get(), late])).val() as unknown;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Realtime Database for the worker; on the emulators through FIREBASE_DATABASE_EMULATOR_HOST. */
export function initRtdb(env: NodeJS.ProcessEnv = process.env): Database {
  initFirestore(env);
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  const host = env.FIREBASE_DATABASE_EMULATOR_HOST;
  const url =
    env.FIREBASE_DATABASE_URL ??
    (host
      ? `http://${host}?ns=${projectId}-default-rtdb`
      : `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`);
  return getDatabaseWithUrl(url, getApps()[0]);
}

/** Writes `live/…` and `proctor/…` as the API does when it finishes or strikes an attempt (DATA-07). */
export function liveMirror(rtdb: Database): LiveMirror {
  return {
    async finished(orgId, attempt, now) {
      const live = liveRecordPath(orgId, attempt.testId, attempt.id);
      await rtdb.ref().update({
        [`${live}/status`]: attempt.status,
        [`${live}/strikes`]: attempt.strikesCount,
        ...(attempt.result
          ? { [`${live}/answered`]: attempt.draw.questionIds.length - attempt.result.unanswered }
          : {}),
        [`${live}/updatedAt`]: now,
        [`${proctorPath(orgId, attempt.id)}/status`]: attempt.status,
      });
    },
    async strikes(orgId, attempt, now) {
      await rtdb
        .ref(liveRecordPath(orgId, attempt.testId, attempt.id))
        .update({ strikes: attempt.strikesCount, updatedAt: now });
    },
    async serverStrike(orgId, attemptId, strike) {
      await rtdb.ref(`${proctorPath(orgId, attemptId)}/strike`).set(strike);
    },
  };
}
