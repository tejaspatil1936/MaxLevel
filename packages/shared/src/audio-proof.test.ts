import { describe, expect, it } from 'vitest';
import {
  AUDIO_PROOF_MAX_BYTES,
  AUDIO_PROOF_RETENTION_MS,
  audioCleanupTask,
  audioProofPath,
  audioProofUploadSchema,
  audioSignatureMatches,
  isAudioProofPath,
} from './audio-proof';

const bytes = (...b: number[]) => Uint8Array.from([...b, 0, 0, 0, 0]);

describe('audio proof clips', () => {
  it('SEC-06 a clip is accepted only when its bytes are the declared container', () => {
    expect(audioSignatureMatches('audio/webm', bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe(true);
    expect(audioSignatureMatches('audio/ogg', bytes(0x4f, 0x67, 0x67, 0x53))).toBe(true);
    expect(audioSignatureMatches('audio/mp4', bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70))).toBe(true);
    expect(audioSignatureMatches('audio/webm', bytes(0x4f, 0x67, 0x67, 0x53))).toBe(false);
    expect(audioSignatureMatches('audio/mp4', bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
  });

  it('the upload body is a clip ID, an audio type and base64 data within the size limit', () => {
    const ok = { clipId: 'clip-12345678', contentType: 'audio/webm', data: 'GkXfow==' };
    expect(audioProofUploadSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, clipId: '../x' },
      { ...ok, contentType: 'video/webm' },
      { ...ok, data: 'x'.repeat(Math.ceil(AUDIO_PROOF_MAX_BYTES / 3) * 4 + 1) },
      { ...ok, extra: 1 },
    ])
      expect(audioProofUploadSchema.safeParse(bad).success).toBe(false);
  });

  it('a clip is stored under its attempt and deleted by one task when its 14 days end', () => {
    const path = audioProofPath('org-a', 'att-1', 'clip-12345678', 'audio/mp4');
    expect(path).toBe('organizations/org-a/attempts/att-1/audio/clip-12345678.m4a');
    expect(AUDIO_PROOF_RETENTION_MS).toBe(14 * 86_400_000);
    expect(audioCleanupTask('org-a', 'att-1', 'clip-12345678', path, 1_000)).toEqual({
      name: 'audio-cleanup-att-1-clip-12345678',
      path: '/tasks/audio-cleanup',
      payload: { orgId: 'org-a', path },
      scheduleTime: 1_000 + AUDIO_PROOF_RETENTION_MS,
    });
  });

  it('ORG-03 the cleanup deletes only audio clips of its own organization', () => {
    expect(isAudioProofPath('org-a', 'organizations/org-a/attempts/att-1/audio/clip-12345678.webm')).toBe(true);
    for (const path of [
      'organizations/org-b/attempts/att-1/audio/clip-12345678.webm',
      'organizations/org-a/logo.png',
      'organizations/org-a/attempts/att-1/audio/../../logo.png',
      'organizations/org-a/exports/x.webm',
    ])
      expect(isAudioProofPath('org-a', path), path).toBe(false);
  });
});
