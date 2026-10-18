import { z } from 'zod';
import type { Settings } from './settings';

// Proctoring events and strikes (spec 7.8, PR-07, PR-08). The server decides every count; times are server time.

export const PROCTOR_EVENT_TYPES = [
  'fullscreen_exit',
  'tab_hidden',
  'window_blur',
  'no_face',
  'multiple_faces',
  'devtools',
  'phone_disconnected',
  'context_menu',
  'clipboard',
  'print',
  'late_sync',
  'note',
] as const;
export const proctorEventTypeSchema = z.enum(PROCTOR_EVENT_TYPES);
export type ProctorEventType = z.infer<typeof proctorEventTypeSchema>;

/** Types a student's browser may report; `late_sync` and `note` are written by the server only. */
export const CLIENT_EVENT_TYPES = PROCTOR_EVENT_TYPES.filter(
  (t): t is Exclude<ProctorEventType, 'late_sync' | 'note'> => t !== 'late_sync' && t !== 'note',
);

/** Types that are always strikes; `devtools` is one only under the `block_strike` policy. */
const STRIKE_TYPES: ReadonlySet<ProctorEventType> = new Set([
  'fullscreen_exit',
  'tab_hidden',
  'window_blur',
  'no_face',
  'multiple_faces',
  'phone_disconnected',
]);

/** One incident is one strike (PR-07): a strike event this soon after the last counted one is logged, not counted. */
export const STRIKE_DEDUPE_MS = 3000;

/** Whether an event of this type is a strike; every other event is logged only (PR-06, PR-11). */
export function isStrikeEvent(type: ProctorEventType, devtoolsPolicy: Settings['devtoolsPolicy']): boolean {
  if (type === 'devtools') return devtoolsPolicy === 'block_strike';
  return STRIKE_TYPES.has(type);
}

/** Whether a strike event at `now` is a new incident: no strike was counted yet, or the last was 3 s or more ago. */
export function countsAsNewStrike(lastStrikeAt: number | undefined, now: number): boolean {
  return lastStrikeAt === undefined || now - lastStrikeAt >= STRIKE_DEDUPE_MS;
}
