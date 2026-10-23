import { isAudioProofPath, type AudioCleanupPayload } from '@mitaoe/shared';
import type { ClipStore } from '../firebase';

export { audioCleanupPayloadSchema } from '@mitaoe/shared';

export type AudioCleanupOutcome = 'deleted' | 'refused';

/**
 * /tasks/audio-cleanup (owner request 2026-10-23, REL-04): deletes one voice proof clip when its retention ends. Only
 * a path inside the payload organization's attempt audio folders is deleted (ORG-03); a clip already gone (a purge, an
 * earlier run) counts as deleted, so a retry changes nothing.
 */
export function audioCleanupHandler(deps: { clips: ClipStore }) {
  return async (run: AudioCleanupPayload): Promise<AudioCleanupOutcome> => {
    if (!isAudioProofPath(run.orgId, run.path)) return 'refused';
    await deps.clips.remove(run.path);
    return 'deleted';
  };
}
