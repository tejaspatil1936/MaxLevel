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
  'phone_in_view',
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
  'phone_in_view',
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

/** What one reported event does to an attempt's strikes (PR-07, PR-08, PR-10). */
export interface StrikeVerdict {
  /** The event is a new incident and adds one strike. */
  counted: boolean;
  /** The attempt's strike count with this event, when it counted. */
  strikeNumber?: number;
  /** The attempt has reached its maximum and ends: with this strike, or already before it. */
  terminates: boolean;
}

/**
 * Decides an event against the attempt's stored strikes, never the client's count (PR-08): a strike event counts when
 * it is a new incident on the server clock (PR-07) and the maximum is not yet reached; the strike that reaches
 * `maxStrikes` ends the attempt (PR-10). An attempt already at its maximum counts nothing more and still ends, so a
 * termination that did not finish is completed by the next event.
 */
export function strikeVerdict(input: {
  type: ProctorEventType;
  devtoolsPolicy: Settings['devtoolsPolicy'];
  maxStrikes: number;
  strikesCount: number;
  lastStrikeAt: number | undefined;
  now: number;
}): StrikeVerdict {
  const atMax = input.strikesCount >= input.maxStrikes;
  if (atMax || !isStrikeEvent(input.type, input.devtoolsPolicy) || !countsAsNewStrike(input.lastStrikeAt, input.now))
    return { counted: false, terminates: atMax };
  const strikeNumber = input.strikesCount + 1;
  return { counted: true, strikeNumber, terminates: strikeNumber >= input.maxStrikes };
}
