import { describe, expect, it } from 'vitest';
import {
  initialPhoneWatch,
  nextPhoneWatch,
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
    expect(PHONE_RECONNECT_AFTER_MS).toBe(15_000);
    expect(PHONE_STRIKE_AFTER_MS).toBe(60_000);
    expect(presencePath('org-a', 't1', 'a1', 'phone')).toBe('presence/org-a/t1/a1/phone');
  });

  it('PR-16 a phone gone for over 15 seconds needs reconnecting and over 60 seconds is one strike', () => {
    const looks = run([
      { at: 0, phoneOnline: true },
      { at: 1_000, phoneOnline: false },
      { at: 16_000, phoneOnline: false },
      { at: 16_001, phoneOnline: false },
      { at: 61_000, phoneOnline: false },
      { at: 61_001, phoneOnline: false },
      { at: 120_000, phoneOnline: false },
    ]);
    expect(looks).toEqual([
      { at: 0, link: 'connected', reconnect: false, report: undefined },
      { at: 1_000, link: 'disconnected', reconnect: false, report: undefined },
      { at: 16_000, link: 'disconnected', reconnect: false, report: undefined },
      { at: 16_001, link: 'disconnected', reconnect: true, report: undefined },
      { at: 61_000, link: 'disconnected', reconnect: true, report: undefined },
      { at: 61_001, link: 'disconnected', reconnect: true, report: 60_001 },
      { at: 120_000, link: 'disconnected', reconnect: true, report: undefined },
    ]);
  });

  it('PR-16 the phone coming back ends the disconnection, and a later one is timed afresh', () => {
    const looks = run([
      { at: 0, phoneOnline: false },
      { at: 70_000, phoneOnline: false },
      { at: 71_000, phoneOnline: true },
      { at: 72_000, phoneOnline: false },
      { at: 100_000, phoneOnline: false },
      { at: 132_001, phoneOnline: false },
    ]);
    expect(looks.map((l) => [l.link, l.reconnect, l.report])).toEqual([
      ['disconnected', false, undefined],
      ['disconnected', true, 70_000],
      ['connected', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', true, undefined],
      ['disconnected', true, 60_001],
    ]);
  });

  it('REL-05 while the laptop cannot reach Realtime Database nothing is timed, overlaid or reported', () => {
    const looks = run([
      { at: 0, phoneOnline: true },
      { at: 1_000, laptopConnected: false, phoneOnline: true },
      { at: 2_000, laptopConnected: false, phoneOnline: false },
      { at: 80_000, laptopConnected: false, phoneOnline: false },
      { at: 81_000, phoneOnline: false },
      { at: 96_000, phoneOnline: false },
      { at: 96_001, phoneOnline: false },
    ]);
    expect(looks.map((l) => [l.link, l.reconnect, l.report])).toEqual([
      ['connected', false, undefined],
      ['unavailable', false, undefined],
      ['unavailable', false, undefined],
      ['unavailable', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', false, undefined],
      ['disconnected', true, undefined],
    ]);
  });
});
