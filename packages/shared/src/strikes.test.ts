import { describe, expect, it } from 'vitest';
import {
  CLIENT_EVENT_TYPES,
  PROCTOR_EVENT_TYPES,
  STRIKE_DEDUPE_MS,
  countsAsNewStrike,
  isStrikeEvent,
  strikeVerdict,
} from './strikes';

const STRIKES = [
  'fullscreen_exit',
  'tab_hidden',
  'window_blur',
  'no_face',
  'multiple_faces',
  'phone_disconnected',
  'phone_in_view',
];

describe('isStrikeEvent', () => {
  it('PR-08 PR-11 the seven incident types are strikes under every devtools policy', () => {
    for (const policy of ['block_strike', 'block', 'allow'] as const) {
      for (const type of STRIKES) expect(isStrikeEvent(type as never, policy), `${type} ${policy}`).toBe(true);
    }
  });

  it('PR-11 devtools is a strike only under block_strike', () => {
    expect(isStrikeEvent('devtools', 'block_strike')).toBe(true);
    expect(isStrikeEvent('devtools', 'block')).toBe(false);
    expect(isStrikeEvent('devtools', 'allow')).toBe(false);
  });

  it('PR-11 context menu, clipboard, print, phone paused, late sync and notes are logged only', () => {
    for (const type of ['context_menu', 'clipboard', 'print', 'phone_paused', 'late_sync', 'note'] as const) {
      expect(isStrikeEvent(type, 'block_strike'), type).toBe(false);
    }
  });

  it('PR-08 PR-16 a browser may report every type but late_sync, note and the phone outage strike', () => {
    expect(CLIENT_EVENT_TYPES).toEqual(
      PROCTOR_EVENT_TYPES.filter((t) => t !== 'late_sync' && t !== 'note' && t !== 'phone_disconnected'),
    );
  });
});

describe('countsAsNewStrike', () => {
  const now = 1_793_592_000_000;

  it('PR-07 the first strike always counts', () => {
    expect(countsAsNewStrike(undefined, now)).toBe(true);
  });

  it('PR-07 a strike less than 3 seconds after the last counted one does not count', () => {
    expect(STRIKE_DEDUPE_MS).toBe(3000);
    expect(countsAsNewStrike(now, now)).toBe(false);
    expect(countsAsNewStrike(now - 2999, now)).toBe(false);
    expect(countsAsNewStrike(now + 500, now), 'an earlier server time is not a new incident').toBe(false);
  });

  it('PR-07 a strike 3 seconds or more after the last counted one counts', () => {
    expect(countsAsNewStrike(now - 3000, now)).toBe(true);
    expect(countsAsNewStrike(now - 60_000, now)).toBe(true);
  });
});

describe('strikeVerdict', () => {
  const now = 1_793_592_000_000;
  const base = {
    devtoolsPolicy: 'block_strike' as const,
    maxStrikes: 3,
    strikesCount: 0,
    lastStrikeAt: undefined,
    now,
  };

  it('PR-08 a new incident adds one to the stored count, whatever the client counted', () => {
    expect(strikeVerdict({ ...base, type: 'tab_hidden' })).toEqual({
      counted: true,
      strikeNumber: 1,
      terminates: false,
    });
    expect(strikeVerdict({ ...base, type: 'no_face', strikesCount: 1, lastStrikeAt: now - 3000 })).toEqual({
      counted: true,
      strikeNumber: 2,
      terminates: false,
    });
  });

  it('PR-07 a strike within 3 seconds of the last counted one and a logged-only type count nothing', () => {
    const recent = { ...base, strikesCount: 1, lastStrikeAt: now - 2999 };
    expect(strikeVerdict({ ...recent, type: 'window_blur' })).toEqual({ counted: false, terminates: false });
    expect(strikeVerdict({ ...base, type: 'context_menu' })).toEqual({ counted: false, terminates: false });
    expect(strikeVerdict({ ...base, type: 'devtools', devtoolsPolicy: 'block' })).toEqual({
      counted: false,
      terminates: false,
    });
  });

  it('PR-10 the strike that reaches the maximum ends the attempt, and one at the maximum counts nothing more', () => {
    const last = { ...base, strikesCount: 2, lastStrikeAt: now - 5000 };
    expect(strikeVerdict({ ...last, type: 'devtools' })).toEqual({ counted: true, strikeNumber: 3, terminates: true });
    expect(strikeVerdict({ ...base, maxStrikes: 1, type: 'fullscreen_exit' })).toMatchObject({ terminates: true });
    const full = { ...base, strikesCount: 3, lastStrikeAt: now - 60_000 };
    expect(strikeVerdict({ ...full, type: 'tab_hidden' })).toEqual({ counted: false, terminates: true });
    expect(strikeVerdict({ ...full, type: 'clipboard' })).toEqual({ counted: false, terminates: true });
  });
});
