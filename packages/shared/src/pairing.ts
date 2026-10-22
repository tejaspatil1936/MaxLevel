import { z } from 'zod';
import type { TaskRequest } from './tasks';

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
/**
 * A phone record that has not changed for longer than this is stale: the page is frozen or its connection died
 * without the database noticing yet. Three missed heartbeats.
 */
export const PHONE_STALE_AFTER_MS = 15_000;

/** `POST /v1/attempts/{id}/pairing-token`: a new single-use pairing link. */
export const pairingTokenSchema = z.object({ token: z.string(), url: z.string(), expiresAt: ms });
export type PairingToken = z.infer<typeof pairingTokenSchema>;

/** `POST /v1/tests/{testId}/pairing-token`: the link plus the attempt ID it reserves before Start. */
export const pairingReservationSchema = pairingTokenSchema.extend({ attemptId: id });
export type PairingReservation = z.infer<typeof pairingReservationSchema>;

/** `POST /v1/pairing/redeem` (PR-14), sent by the phone with no sign-in. */
export const pairingRedeemSchema = z.object({ token: z.string().min(1).max(256) }).strict();
export const pairingRedeemResultSchema = z.object({
  customToken: z.string(),
  orgId: id,
  testId: id,
  attemptId: id,
  /** This pairing's session: every presence write carries it, and a newer pairing replaces it (DATA-10). */
  session: z.string(),
});
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

/** The phone camera: `starting` until it first plays, `paused` when the OS muted or ended it, `failed` when refused. */
export const PHONE_CAMERA_STATES = ['starting', 'live', 'paused', 'failed'] as const;
export type PhoneCamera = (typeof PHONE_CAMERA_STATES)[number];

/**
 * `presence/…/phone`. `stateSince` is the server time the phone last turned healthy or unhealthy (online with a live
 * camera, or not), so one outage keeps one value; `session` names the pairing that wrote it (DATA-10 checks it). A
 * record written by an older phone page has only the first three.
 */
export interface PhonePresence {
  online: boolean;
  lastSeen: number;
  cameraOn: boolean;
  camera?: PhoneCamera;
  visible?: boolean;
  session?: string;
  stateSince?: number;
}

/** Healthy: online with a live camera. A record from an older phone page has no `camera`, only `cameraOn`. */
export function phoneHealthy(record: Partial<PhonePresence> | null | undefined): boolean {
  if (!record || record.online !== true) return false;
  return record.camera === undefined ? record.cameraOn === true : record.camera === 'live';
}

// ---------- server-written proctoring record (spec 10.2) ----------

/**
 * `proctor/{orgId}/{attemptId}`: written only by the API and the worker; the attempt's student and its paired phone
 * read it. `phoneSession` is the current pairing (an older phone sees it was replaced), `status` the attempt's status
 * (the phone stops when it ends), `strike` the last strike the server decided on its own (the laptop shows it).
 */
export const proctorPath = (orgId: string, attemptId: string) => `proctor/${orgId}/${attemptId}`;

export const serverStrikeSchema = z.object({
  eventId: z.string(),
  type: z.literal('phone_disconnected'),
  strikesCount: z.number().int(),
  status: z.string(),
});
export type ServerStrike = z.infer<typeof serverStrikeSchema>;

export const proctorRecordSchema = z.object({
  phoneSession: z.string().optional(),
  status: z.string().optional(),
  strike: serverStrikeSchema.optional(),
});
export type ProctorRecord = z.infer<typeof proctorRecordSchema>;

// ---------- the server's check of a phone outage (PR-16, REL-05) ----------

/**
 * Which outage the laptop saw: the phone record's `stateSince` and `lastSeen` at that moment (null when there was no
 * record). The worker strikes only while the record still shows that same outage.
 */
export interface PhoneOutage {
  stateSince: number | null;
  lastSeen: number | null;
}

/** Reads the outage from a `phone_paused` report's details; anything malformed is null, which the check handles. */
export function outageOf(details: Record<string, unknown>): PhoneOutage {
  const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
  return { stateSince: num(details.stateSince), lastSeen: num(details.lastSeen) };
}

export type PhoneCheckVerdict = 'strike' | 'recovered' | 'laptop_offline' | 'finished';

/**
 * The worker's look at a phone outage the laptop reported, once it is due (PR-16). Nothing for a finished attempt; no
 * strike while the laptop is offline too, since the student's whole connection is down, or ours (REL-05). Otherwise the
 * outage is still going on when the phone has had no healthy heartbeat since the report: it is missing, unhealthy
 * since the same moment, or healthy on paper but frozen with the same `lastSeen`.
 */
export function phoneCheckVerdict(input: {
  attemptStatus: string | null;
  laptop: { online?: unknown } | null;
  phone: Partial<PhonePresence> | null;
  outage: PhoneOutage;
}): PhoneCheckVerdict {
  const { phone, outage } = input;
  if (input.attemptStatus !== 'in_progress') return 'finished';
  if (input.laptop?.online !== true) return 'laptop_offline';
  if (!phone) return 'strike';
  if (phoneHealthy(phone)) return phone.lastSeen === outage.lastSeen ? 'strike' : 'recovered';
  return phone.stateSince === outage.stateSince ? 'strike' : 'recovered';
}

export const phoneCheckPayloadSchema = z.object({
  orgId: id,
  attemptId: id,
  stateSince: ms.nullable(),
  lastSeen: ms.nullable(),
});
export type PhoneCheckPayload = z.infer<typeof phoneCheckPayloadSchema>;

/**
 * The worker's check of one outage at `dueAt`. The name carries the outage, so the laptop reporting it again (a retry,
 * a reload) stores one task, and a new outage gets a task of its own (REL-04).
 */
export function phoneCheckTask(
  orgId: string,
  attemptId: string,
  outage: PhoneOutage,
  dueAt: number,
): TaskRequest<PhoneCheckPayload> {
  return {
    name: `phone-check-${attemptId}-${outage.stateSince ?? 'none'}-${outage.lastSeen ?? 'none'}`,
    path: '/tasks/phone-check',
    payload: { orgId, attemptId, ...outage },
    scheduleTime: dueAt,
  };
}

/**
 * When the check of a reported outage is due: when the outage reaches `PHONE_STRIKE_AFTER_MS` as the laptop measured
 * it (`offlineMs` at `clientTs`, both clamped), never in the past and never more than the limit away.
 */
export function phoneCheckDueAt(report: { clientTs: number; offlineMs: unknown }, now: number): number {
  const offline = typeof report.offlineMs === 'number' && Number.isFinite(report.offlineMs) ? report.offlineMs : 0;
  const left = PHONE_STRIKE_AFTER_MS - Math.min(Math.max(offline, 0), PHONE_STRIKE_AFTER_MS);
  return Math.min(Math.max(report.clientTs + left, now), now + PHONE_STRIKE_AFTER_MS);
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
