import {
  AUDIO_PROOF_MAX_BYTES,
  AUDIO_PROOFS_PER_ATTEMPT,
  audioCleanupTask,
  audioProofPath,
  audioProofPrefix,
  audioSignatureMatches,
  type AudioProofUpload,
  type Clock,
  type TaskQueue,
} from '@mitaoe/shared';
import type { Data } from '../data';
import { AppError, notFound } from '../errors';
import type { FirebaseHandles } from '../firebase';

/**
 * Voice proof clips (owner request 2026-10-23): the exam screen uploads a short clip when it detects sustained talking,
 * and admins play it from the attempt's timeline. A clip is stored only for an attempt in progress whose test has
 * voice detection on, at most AUDIO_PROOFS_PER_ATTEMPT per attempt, checked by file signature (SEC-06), in the bucket
 * no client reads (DATA-09), and deleted by the worker after its retention period.
 */
export function audioProofService(deps: {
  data: Data;
  clock: Clock;
  queue: TaskQueue;
  firebase: Pick<FirebaseHandles, 'bucket'>;
}) {
  const { data, clock, queue, firebase } = deps;
  const finished = () => new AppError(409, 'ATTEMPT_FINISHED', "You've already finished this test.");

  return {
    /** POST /v1/attempts/{id}/audio-proof: the caller's own attempt in progress (another's is 404). */
    async upload(
      orgId: string,
      studentId: string,
      attemptId: string,
      clip: AudioProofUpload,
    ): Promise<{ clipId: string }> {
      const attempt = await data.attempts.getAttempt(orgId, attemptId);
      if (!attempt || attempt.studentId !== studentId) throw notFound('Attempt');
      if (attempt.status !== 'in_progress') throw finished();
      const test = await data.tests.getTest(orgId, attempt.testId);
      if (test?.resolved?.audioProctoring !== true)
        throw new AppError(409, 'AUDIO_PROCTORING_OFF', 'Voice detection is off for this test.');
      const bytes = Buffer.from(clip.data, 'base64');
      if (!bytes.length || bytes.length > AUDIO_PROOF_MAX_BYTES || !audioSignatureMatches(clip.contentType, bytes))
        throw new AppError(400, 'VALIDATION', 'The clip is not a valid audio file.', { field: 'data' });
      const path = audioProofPath(orgId, attemptId, clip.clipId, clip.contentType);
      const file = firebase.bucket.file(path);
      // A retried upload of a stored clip changes nothing and counts once.
      if ((await file.exists())[0]) return { clipId: clip.clipId };
      const reserved = await data.attempts.reserveAudioProof(orgId, attemptId, AUDIO_PROOFS_PER_ATTEMPT);
      if (!reserved) throw notFound('Attempt');
      if (reserved === 'ATTEMPT_FINISHED') throw finished();
      if (reserved === 'LIMIT')
        throw new AppError(409, 'AUDIO_PROOF_LIMIT', 'This attempt has stored all the clips it may.');
      await file.save(bytes, { contentType: clip.contentType, resumable: false });
      await queue.enqueue(audioCleanupTask(orgId, attemptId, clip.clipId, path, clock.now()));
      return { clipId: clip.clipId };
    },

    /** GET /v1/attempts/{id}/audio-proof/{clipId}: the clip for an admin of the attempt's organization, or null. */
    async read(orgId: string, attemptId: string, clipId: string): Promise<{ bytes: Buffer; contentType: string }> {
      if (!(await data.attempts.getAttempt(orgId, attemptId))) throw notFound('Attempt');
      const [files] = await firebase.bucket.getFiles({ prefix: audioProofPrefix(orgId, attemptId, clipId) });
      const file = files[0];
      if (!file) throw notFound('Clip');
      const [bytes] = await file.download();
      const contentType = (file.metadata.contentType as string | undefined) ?? 'application/octet-stream';
      return { bytes, contentType };
    },
  };
}
export type AudioProofService = ReturnType<typeof audioProofService>;
