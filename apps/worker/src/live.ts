import { liveRecordPath, type AttemptRecord } from '@mitaoe/shared';
import { getApps } from 'firebase-admin/app';
import { getDatabaseWithUrl, type Database } from 'firebase-admin/database';
import { initFirestore } from './firebase';

/** The part of the live mirror (spec 10.2, OPS-02) the worker writes: the status of an attempt it finished. */
export interface LiveMirror {
  finished(orgId: string, attempt: AttemptRecord, now: number): Promise<void>;
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

/** Writes `live/{orgId}/{testId}/{attemptId}` as the API does when it finishes an attempt (DATA-07). */
export function liveMirror(rtdb: Database): LiveMirror {
  return {
    async finished(orgId, attempt, now) {
      await rtdb.ref(liveRecordPath(orgId, attempt.testId, attempt.id)).update({
        status: attempt.status,
        strikes: attempt.strikesCount,
        ...(attempt.result ? { answered: attempt.draw.questionIds.length - attempt.result.unanswered } : {}),
        updatedAt: now,
      });
    },
  };
}
