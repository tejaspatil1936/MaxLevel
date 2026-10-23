import { z } from 'zod';
import type { TaskRequest } from './tasks';

// Voice detection proof clips (owner request 2026-10-23; docs/DECISIONS.md). Talking is detected on the student's
// device; only when it is sustained does the device record a short clip, upload it with the `voice_detected` event,
// and the clip is deleted after the retention period. Nothing else from the microphone leaves the device.

/** How long a proof clip is kept before the worker deletes it. */
export const AUDIO_PROOF_RETENTION_MS = 14 * 24 * 60 * 60_000;
/** A clip's size limit: 5 seconds of Opus at 16 to 32 kbit/s is 10 to 20 KB, so this leaves room for other codecs. */
export const AUDIO_PROOF_MAX_BYTES = 256 * 1024;
/** Clips one attempt may upload, so a stuck detector or a hostile client cannot fill the bucket. */
export const AUDIO_PROOFS_PER_ATTEMPT = 20;
/** How long the device records once talking is detected. */
export const AUDIO_PROOF_CLIP_MS = 5_000;

/** The containers browsers record into: WebM or Ogg Opus (Chrome, Edge, Firefox) and MP4 AAC (Safari). */
export const AUDIO_PROOF_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
export type AudioProofType = (typeof AUDIO_PROOF_TYPES)[number];
const EXTENSIONS: Record<AudioProofType, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

/** A clip ID the device makes up; it names the stored file and the event that points at it. */
export const clipIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** POST /v1/attempts/{id}/audio-proof: one clip, base64-encoded; checked by file signature on the server (SEC-06). */
export const audioProofUploadSchema = z
  .object({
    clipId: clipIdSchema,
    contentType: z.enum(AUDIO_PROOF_TYPES),
    data: z
      .string()
      .min(1)
      .max(Math.ceil(AUDIO_PROOF_MAX_BYTES / 3) * 4),
  })
  .strict();
export type AudioProofUpload = z.infer<typeof audioProofUploadSchema>;
export const audioProofResultSchema = z.object({ clipId: z.string() });

/** Where a clip is stored: under its attempt, so a purge of the attempt's folder takes it too. */
export const audioProofPrefix = (orgId: string, attemptId: string, clipId: string) =>
  `organizations/${orgId}/attempts/${attemptId}/audio/${clipId}.`;
export const audioProofPath = (orgId: string, attemptId: string, clipId: string, type: AudioProofType) =>
  `${audioProofPrefix(orgId, attemptId, clipId)}${EXTENSIONS[type]}`;

/** Whether the bytes really are the declared container (file signature, not the name; SEC-06). */
export function audioSignatureMatches(type: AudioProofType, bytes: Uint8Array): boolean {
  const at = (offset: number, ...expected: number[]) => expected.every((b, i) => bytes[offset + i] === b);
  if (type === 'audio/webm') return at(0, 0x1a, 0x45, 0xdf, 0xa3);
  if (type === 'audio/ogg') return at(0, 0x4f, 0x67, 0x67, 0x53);
  return at(4, 0x66, 0x74, 0x79, 0x70);
}

export const audioCleanupPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  path: z.string().min(1).max(512),
});
export type AudioCleanupPayload = z.infer<typeof audioCleanupPayloadSchema>;

/** The worker deletes a clip once its retention ends; the name makes a repeated upload queue one task (REL-04). */
export function audioCleanupTask(
  orgId: string,
  attemptId: string,
  clipId: string,
  path: string,
  storedAt: number,
): TaskRequest<AudioCleanupPayload> {
  return {
    name: `audio-cleanup-${attemptId}-${clipId}`,
    path: '/tasks/audio-cleanup',
    payload: { orgId, path },
    scheduleTime: storedAt + AUDIO_PROOF_RETENTION_MS,
  };
}

/** A clip may be deleted only inside its organization's audio folders (the worker checks the payload it is given). */
export function isAudioProofPath(orgId: string, path: string): boolean {
  return new RegExp(`^organizations/${orgId}/attempts/[A-Za-z0-9_-]+/audio/[A-Za-z0-9_-]{8,64}\\.(webm|ogg|m4a)$`).test(
    path,
  );
}
