import { describe, expect, it } from 'vitest';
import {
  initialPhoneWatch,
  nextPhoneWatch,
  outageOf,
  phoneCheckDueAt,
  phoneCheckTask,
  phoneCheckVerdict,
  phoneHealthy,
  type PhonePresence,
  PAIRING_TOKEN_TTL_MS,
  pairingRedeemSchema,
  pairingTokenVerdict,
  PHONE_HEARTBEAT_MS,
  PHONE_RECONNECT_AFTER_MS,
  PHONE_STRIKE_AFTER_MS,
  presencePath,
  type PhoneWatchState,
} from './pairing';

const T0 = 1_793_592_000_000;

/** Runs presence looks through the watch; returns what each look said. */
function run(looks: Array<{ at: number; laptopConnected?: boolean; phoneOnline: boolean }>) {
  let state: PhoneWatchState = initialPhoneWatch;
  return looks.map(({ at, laptopConnected = true, phoneOnline }) => {
    const next = nextPhoneWatch(state, { laptopConnected, phoneOnline }, T0 + at);
    state = next.state;
    return { at, link: next.link, reconnect: next.reconnect, report: next.report?.afterMs };
  });
}

describe('pairingTokenVerdict', () => {
  it('PR-13 PR-14 a pairing link is valid for 5 minutes and works once', () => {
    expect(PAIRING_TOKEN_TTL_MS).toBe(300_000);
    const expiresAt = T0 + PAIRING_TOKEN_TTL_MS;
    expect(pairingTokenVerdict({ expiresAt }, T0)).toBe('ok');
    expect(pairingTokenVerdict({ expiresAt }, expiresAt - 1)).toBe('ok');
    expect(pairingTokenVerdict({ expiresAt }, expiresAt)).toBe('PAIRING_TOKEN_EXPIRED');
    expect(pairingTokenVerdict({ expiresAt, usedAt: T0 + 1 }, T0 + 2)).toBe('PAIRING_TOKEN_USED');
    expect(pairingTokenVerdict({ expiresAt, usedAt: T0 + 1 }, expiresAt + 1)).toBe('PAIRING_TOKEN_USED');
    expect(pairingTokenVerdict({ expiresAt, usedAt: null }, T0)).toBe('ok');
  });

  it('PR-14 the redeem body is only the token', () => {
    expect(pairingRedeemSchema.parse({ token: 'org-a.abc' })).toEqual({ token: 'org-a.abc' });
    expect(pairingRedeemSchema.safeParse({ token: '' }).success).toBe(false);
    expect(pairingRedeemSchema.safeParse({ token: 'x', orgId: 'org-a' }).success).toBe(false);
  });
});

describe('nextPhoneWatch', () => {
  it('PR-15 PR-16 heartbeats every 5 s, the overlay after more than 15 s and the strike after more than 60 s', () => {
    expect(PHONE_HEARTBEAT_MS).toBe(5_000);
    expect(PHONE_RECONNECT_AFTER_MS).toBe(10_000);
    expect(PHONE_STRIKE_AFTER_MS).toBe(60_000);
    expect(presencePath('org-a', 't1', 'a1', 'phone')).toBe('presence/org-a/t1/a1/phone');
  });

  it('PR-16 a phone gone for over 10 seconds needs reconnecting and is reported paused once', () => {
    const looks = run([
      { at: 0, phoneOnline: true },
      { at: 1_000, phoneOnline: false },
      { at: 11_000, phoneOnline: false },
      { at: 11_001, phoneOnline: false },
      { at: 61_001, phoneOnline: false },
      { at: 120_000, phoneOnline: false },
    ]);
    expect(looks).toEqual([
      { at: 0, link: 'connected', reconnect: false, report: undefined },
      { at: 1_000, link: 'disconnected', reconnect: false, report: undefined },
      { at: 11_000, link: 'disconnected', reconnect: false, report: undefined },
      { at: 11_001, link: 'disconnected', reconnect: true, report: 10_001 },
      { at: 61_001, link: 'disconnected', reconnect: true, report: undefined },
      { at: 120_000, link: 'disconnected', reconnect: true, report: undefined },
    ]);
  });

  it('PR-16 the phone coming back ends the disconnection, and a later one is timed afresh', () => {
    const looks = run([
      { at: 0, phoneOnline: false },
      { at: 70_000, phoneOnline: false },
      { at: 71_000, phoneOnline: true },
      { at: 72_000, phoneOnline: false },
      { at: 82_000, phoneOnline: false },
      { at: 82_001, phoneOnline: false },
    ]);
    expect(looks.map((l) => [l.link, l.reconnect, l.report])).toEqual([
      ['disconnected', false, undefined],
      ['disconnected', true, 70_000],
      ['connected', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', true, 10_001],
    ]);
  });

  it('REL-05 while the laptop cannot reach Realtime Database nothing is timed, overlaid or reported', () => {
    const looks = run([
      { at: 0, phoneOnline: true },
      { at: 1_000, laptopConnected: false, phoneOnline: true },
      { at: 2_000, laptopConnected: false, phoneOnline: false },
      { at: 80_000, laptopConnected: false, phoneOnline: false },
      { at: 81_000, phoneOnline: false },
      { at: 91_000, phoneOnline: false },
      { at: 91_001, phoneOnline: false },
    ]);
    expect(looks.map((l) => [l.link, l.reconnect, l.report])).toEqual([
      ['connected', false, undefined],
      ['unavailable', false, undefined],
      ['unavailable', false, undefined],
      ['unavailable', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', true, 10_001],
    ]);
  });
});

describe('phoneHealthy', () => {
  it('PR-16 a phone is healthy only online with a live camera; an older record falls back to cameraOn', () => {
    const base: PhonePresence = {
      online: true,
      lastSeen: 1,
      cameraOn: true,
      camera: 'live',
      session: 's1',
      stateSince: 1,
    };
    expect(phoneHealthy(base)).toBe(true);
    expect(phoneHealthy({ ...base, online: false })).toBe(false);
    for (const camera of ['starting', 'paused', 'failed'] as const)
      expect(phoneHealthy({ ...base, camera })).toBe(false);
    expect(phoneHealthy({ online: true, lastSeen: 1, cameraOn: true })).toBe(true);
    expect(phoneHealthy({ online: true, lastSeen: 1, cameraOn: false })).toBe(false);
    expect(phoneHealthy(null)).toBe(false);
  });
});

describe('phoneCheckVerdict', () => {
  const outage = { stateSince: 100, lastSeen: 200 };
  const laptop = { online: true };
  const phone = (p: Partial<PhonePresence>): Partial<PhonePresence> => ({
    online: false,
    lastSeen: 200,
    cameraOn: false,
    camera: 'live',
    stateSince: 100,
    ...p,
  });
  const verdict = (p: Partial<PhonePresence> | null, extra: Partial<Parameters<typeof phoneCheckVerdict>[0]> = {}) =>
    phoneCheckVerdict({ attemptStatus: 'in_progress', laptop, phone: p, outage, ...extra });

  it('PR-16 the same outage still going on is a strike: offline, camera paused, missing or frozen', () => {
    expect(verdict(phone({}))).toBe('strike');
    expect(verdict(phone({ online: true, camera: 'paused', lastSeen: 900 }))).toBe('strike');
    expect(verdict(null)).toBe('strike');
    expect(verdict(phone({ online: true, cameraOn: true, camera: 'live', lastSeen: 200 }))).toBe('strike');
  });

  it('PR-16 a phone that came back, even if it dropped again since, is not this outage', () => {
    expect(verdict(phone({ online: true, cameraOn: true, camera: 'live', lastSeen: 900, stateSince: 800 }))).toBe(
      'recovered',
    );
    expect(verdict(phone({ stateSince: 950, lastSeen: 950 }))).toBe('recovered');
  });

  it('REL-05 no strike while the laptop is offline too, and none once the attempt has ended', () => {
    expect(verdict(phone({}), { laptop: { online: false } })).toBe('laptop_offline');
    expect(verdict(phone({}), { laptop: null })).toBe('laptop_offline');
    expect(verdict(phone({}), { attemptStatus: 'submitted' })).toBe('finished');
    expect(verdict(phone({}), { attemptStatus: null })).toBe('finished');
  });
});

describe('phoneCheckDueAt', () => {
  it('PR-16 the check is due when the outage reaches 60 seconds as the laptop measured it', () => {
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: 16_000 }, T0)).toBe(T0 + 44_000);
    // A report that arrives late keeps its own time; one already past the limit is due now.
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: 16_000 }, T0 + 10_000)).toBe(T0 + 44_000);
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: 16_000 }, T0 + 50_000)).toBe(T0 + 50_000);
  });

  it('PR-16 a malformed or out-of-range duration never brings the strike closer than now or further than 60 s', () => {
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: 'x' }, T0)).toBe(T0 + 60_000);
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: -5 }, T0)).toBe(T0 + 60_000);
    expect(phoneCheckDueAt({ clientTs: T0, offlineMs: 999_999 }, T0)).toBe(T0);
    expect(phoneCheckDueAt({ clientTs: T0 + 3_600_000, offlineMs: 0 }, T0)).toBe(T0 + 60_000);
  });
});

describe('phoneCheckTask', () => {
  it('REL-04 one task per outage, named by it, at the due time', () => {
    const task = phoneCheckTask('org-a', 'a1', outageOf({ stateSince: 100, lastSeen: 200 }), T0);
    expect(task).toEqual({
      name: 'phone-check-a1-100-200',
      path: '/tasks/phone-check',
      payload: { orgId: 'org-a', attemptId: 'a1', stateSince: 100, lastSeen: 200 },
      scheduleTime: T0,
    });
    expect(phoneCheckTask('org-a', 'a1', outageOf({ stateSince: 'x' }), T0).name).toBe('phone-check-a1-none-none');
  });
});
