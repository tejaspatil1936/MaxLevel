// Laptop camera rules (spec 7.6, PR-01, PR-02): how often the device looks for faces and phones and when what it sees
// is an incident. Only the event leaves the device, never an image. Times are any one clock in milliseconds.

/** Face detection runs on the device every 500 ms (PR-01). */
export const FACE_CHECK_INTERVAL_MS = 500;
/** No face for longer than this is a `no_face` incident (PR-02's grace period). */
export const NO_FACE_GRACE_MS = 5000;
/** More than one face for longer than this is a `multiple_faces` incident (PR-02). */
export const MULTIPLE_FACES_MS = 2000;
/** A camera incident that is still going on this long after its last report is reported again (one more strike). */
export const INCIDENT_REPEAT_MS = 30_000;
/** Phone detection is heavier than face detection, so it runs every second. */
export const PHONE_CHECK_INTERVAL_MS = 1000;
/** A phone in view for longer than this is a `phone_in_view` incident. */
export const PHONE_IN_VIEW_MS = 1500;
/** A phone must be seen in at least this many checks before it counts, so one wrong detection is never a strike. */
export const PHONE_MIN_SIGHTINGS = 3;
/** A phone not seen for at most this long is still the same sighting: one missed check of a hand-held phone. */
export const PHONE_GAP_MS = 2000;

export type FaceIncident = 'no_face' | 'multiple_faces';
export type CameraIncident = FaceIncident | 'phone_in_view';

/** What the watch is following: no face or several faces since `since`, and when that was last reported. */
export interface FaceWatchState {
  kind: FaceIncident | null;
  since: number;
  reportedAt: number | null;
}

export const initialFaceWatch: FaceWatchState = { kind: null, since: 0, reportedAt: null };

const LIMITS: Record<FaceIncident, number> = { no_face: NO_FACE_GRACE_MS, multiple_faces: MULTIPLE_FACES_MS };

/** Whether an incident going on since `since` and last reported at `reportedAt` is reported at `now`. */
function due(since: number, reportedAt: number | null, limit: number, now: number): boolean {
  return reportedAt === null ? now - since > limit : now - reportedAt >= INCIDENT_REPEAT_MS;
}

/**
 * One detection result at `now`. A condition that lasts longer than its limit is reported (`report`), and again every
 * `INCIDENT_REPEAT_MS` while it goes on, so a student who stays out of view keeps collecting strikes. No face ends when
 * a face is seen, several faces when at most one is. Exactly one face ends either incident.
 */
export function nextFaceWatch(
  state: FaceWatchState,
  faces: number,
  now: number,
): { state: FaceWatchState; report?: { type: FaceIncident; afterMs: number } } {
  const kind: FaceIncident | null = faces === 0 ? 'no_face' : faces > 1 ? 'multiple_faces' : null;
  if (kind === null) return { state: initialFaceWatch };
  if (state.kind !== kind) return { state: { kind, since: now, reportedAt: null } };
  if (!due(state.since, state.reportedAt, LIMITS[kind], now)) return { state };
  return { state: { ...state, reportedAt: now }, report: { type: kind, afterMs: now - state.since } };
}

/** A phone sighting: first and last seen, how many checks saw it, and when it was last reported. */
export interface PhoneSightState {
  since: number;
  lastSeen: number;
  sightings: number;
  reportedAt: number | null;
}

/**
 * One phone detection result at `now` (`phones` in view). A phone seen in at least `PHONE_MIN_SIGHTINGS` checks over
 * more than `PHONE_IN_VIEW_MS` is reported, and again every `INCIDENT_REPEAT_MS` while it stays. Misses of at most
 * `PHONE_GAP_MS` keep the sighting going; a longer one ends it.
 */
export function nextPhoneSight(
  state: PhoneSightState | null,
  phones: number,
  now: number,
): { state: PhoneSightState | null; report?: { type: 'phone_in_view'; afterMs: number } } {
  const going = state !== null && now - state.lastSeen <= PHONE_GAP_MS;
  if (phones === 0) return { state: going ? state : null };
  const next: PhoneSightState = going
    ? { ...state, lastSeen: now, sightings: state.sightings + 1 }
    : { since: now, lastSeen: now, sightings: 1, reportedAt: null };
  if (next.sightings < PHONE_MIN_SIGHTINGS || !due(next.since, next.reportedAt, PHONE_IN_VIEW_MS, now))
    return { state: next };
  return { state: { ...next, reportedAt: now }, report: { type: 'phone_in_view', afterMs: now - next.since } };
}
