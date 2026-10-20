// Laptop camera rules (spec 7.6, PR-01, PR-02): how often the device looks for faces and when what it sees is an
// incident. Only the event leaves the device, never an image. Times are any one clock in milliseconds.

/** Face detection runs on the device every 500 ms (PR-01). */
export const FACE_CHECK_INTERVAL_MS = 500;
/** No face for longer than this is a `no_face` incident (PR-02's grace period). */
export const NO_FACE_GRACE_MS = 5000;
/** More than one face for longer than this is a `multiple_faces` incident (PR-02). */
export const MULTIPLE_FACES_MS = 2000;

export type FaceIncident = 'no_face' | 'multiple_faces';

/** What the watch is following: no face or several faces since `since`, and whether that was already reported. */
export interface FaceWatchState {
  kind: FaceIncident | null;
  since: number;
  reported: boolean;
}

export const initialFaceWatch: FaceWatchState = { kind: null, since: 0, reported: false };

const LIMITS: Record<FaceIncident, number> = { no_face: NO_FACE_GRACE_MS, multiple_faces: MULTIPLE_FACES_MS };

/**
 * One detection result at `now`. A condition that lasts longer than its limit is reported once (`report`) and stays one
 * incident until it ends: no face ends when a face is seen, several faces when at most one is. A camera that never
 * sees a face therefore reports exactly one `no_face`. Exactly one face ends either incident.
 */
export function nextFaceWatch(
  state: FaceWatchState,
  faces: number,
  now: number,
): { state: FaceWatchState; report?: { type: FaceIncident; afterMs: number } } {
  const kind: FaceIncident | null = faces === 0 ? 'no_face' : faces > 1 ? 'multiple_faces' : null;
  if (kind === null) return { state: initialFaceWatch };
  if (state.kind !== kind) return { state: { kind, since: now, reported: false } };
  const afterMs = now - state.since;
  if (state.reported || afterMs <= LIMITS[kind]) return { state };
  return { state: { ...state, reported: true }, report: { type: kind, afterMs } };
}
