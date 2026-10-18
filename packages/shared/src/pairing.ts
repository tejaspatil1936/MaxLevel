import { z } from 'zod';

// The phone as a second camera (spec 7.9, PR-13 to PR-17; docs/testids/phase-3.md "Phone pairing"): the pairing
// link's lifetime, the redeem exchange, the presence records in Realtime Database (spec 10.2) and how the laptop
// judges the phone's presence (PR-16, REL-05). Times are epoch ms on the server clock.

const ms = z.number().int();
const id = z.string().min(1).max(128);

/** A pairing link is valid for 5 minutes and works once (PR-13). */
export const PAIRING_TOKEN_TTL_MS = 5 * 60_000;
/** The phone writes its presence every 5 seconds (PR-15). */
export const PHONE_HEARTBEAT_MS = 5_000;
/** A phone disconnected for longer than this brings up the reconnect overlay (PR-16). */
export const PHONE_RECONNECT_AFTER_MS = 15_000;
/** A phone disconnected for longer than this is one `phone_disconnected` strike (PR-16). */
export const PHONE_STRIKE_AFTER_MS = 60_000;

/** `POST /v1/attempts/{id}/pairing-token`: a new single-use pairing link. */
export const pairingTokenSchema = z.object({ token: z.string(), url: z.string(), expiresAt: ms });
export type PairingToken = z.infer<typeof pairingTokenSchema>;

/** `POST /v1/tests/{testId}/pairing-token`: the link plus the attempt ID it reserves before Start. */
export const pairingReservationSchema = pairingTokenSchema.extend({ attemptId: id });
export type PairingReservation = z.infer<typeof pairingReservationSchema>;

/** `POST /v1/pairing/redeem` (PR-14), sent by the phone with no sign-in. */
export const pairingRedeemSchema = z.object({ token: z.string().min(1).max(256) }).strict();
export const pairingRedeemResultSchema = z.object({ customToken: z.string(), orgId: id, testId: id, attemptId: id });
export type PairingRedeemResult = z.infer<typeof pairingRedeemResultSchema>;

/** Why a pairing token can't be redeemed; an unknown token is `PAIRING_TOKEN_INVALID`. */
export type PairingRefusal = 'PAIRING_TOKEN_USED' | 'PAIRING_TOKEN_EXPIRED';

/** PR-13, PR-14: a used token stays used; an unused one is redeemable until 5 minutes after it was issued. */
export function pairingTokenVerdict(
  token: { expiresAt: number; usedAt?: number | null },
  now: number,
): 'ok' | PairingRefusal {
  if (token.usedAt != null) return 'PAIRING_TOKEN_USED';
  return now < token.expiresAt ? 'ok' : 'PAIRING_TOKEN_EXPIRED';
}

// ---------- Realtime Database presence (spec 10.2) ----------

export type PresenceDevice = 'laptop' | 'phone';

export const presencePath = (orgId: string, testId: string, attemptId: string, device: PresenceDevice) =>
  `presence/${orgId}/${testId}/${attemptId}/${device}`;

export interface LaptopPresence {
  online: boolean;
  lastSeen: number;
  fullscreen: boolean;
  visible: boolean;
}

export interface PhonePresence {
  online: boolean;
  lastSeen: number;
  cameraOn: boolean;
}

// ---------- the laptop watching the phone (PR-16, REL-05) ----------

/** What the exam banner says: the phone's state, or `unavailable` while the laptop can't reach Realtime Database. */
export type PhoneLink = 'connected' | 'disconnected' | 'unavailable';

/** The disconnection being followed: since when (server time), and whether its strike was reported. */
export interface PhoneWatchState {
  offlineSince: number | null;
  reported: boolean;
}

export const initialPhoneWatch: PhoneWatchState = { offlineSince: null, reported: false };

/**
 * One look at the phone's presence at `now`. While the laptop's own Realtime Database connection is down the phone's
 * state is unknown: nothing is timed and nothing reported, and the disconnection starts over once the laptop is back
 * (REL-05), so our outage never counts against the student. A phone that is offline (or has no record) for more than
 * 15 seconds needs the reconnect overlay, and for more than 60 seconds is reported once as a strike (PR-16); coming
 * back online ends the disconnection.
 */
export function nextPhoneWatch(
  state: PhoneWatchState,
  seen: { laptopConnected: boolean; phoneOnline: boolean },
  now: number,
): { state: PhoneWatchState; link: PhoneLink; reconnect: boolean; report?: { afterMs: number } } {
  if (!seen.laptopConnected) return { state: initialPhoneWatch, link: 'unavailable', reconnect: false };
  if (seen.phoneOnline) return { state: initialPhoneWatch, link: 'connected', reconnect: false };
  const since = state.offlineSince ?? now;
  const afterMs = now - since;
  const reconnect = afterMs > PHONE_RECONNECT_AFTER_MS;
  if (state.reported || afterMs <= PHONE_STRIKE_AFTER_MS)
    return { state: { offlineSince: since, reported: state.reported }, link: 'disconnected', reconnect };
  return { state: { offlineSince: since, reported: true }, link: 'disconnected', reconnect, report: { afterMs } };
}
