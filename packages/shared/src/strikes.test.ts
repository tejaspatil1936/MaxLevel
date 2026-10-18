import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_TYPES, PROCTOR_EVENT_TYPES, STRIKE_DEDUPE_MS, countsAsNewStrike, isStrikeEvent } from './strikes';

const STRIKES = ['fullscreen_exit', 'tab_hidden', 'window_blur', 'no_face', 'multiple_faces', 'phone_disconnected'];

describe('isStrikeEvent', () => {
  it('PR-08 PR-11 the six incident types are strikes under every devtools policy', () => {
    for (const policy of ['block_strike', 'block', 'allow'] as const) {
      for (const type of STRIKES) expect(isStrikeEvent(type as never, policy), `${type} ${policy}`).toBe(true);
    }
  });

  it('PR-11 devtools is a strike only under block_strike', () => {
    expect(isStrikeEvent('devtools', 'block_strike')).toBe(true);
    expect(isStrikeEvent('devtools', 'block')).toBe(false);
    expect(isStrikeEvent('devtools', 'allow')).toBe(false);
  });

  it('PR-11 context menu, clipboard, print, late sync and notes are logged only', () => {
    for (const type of ['context_menu', 'clipboard', 'print', 'late_sync', 'note'] as const) {
      expect(isStrikeEvent(type, 'block_strike'), type).toBe(false);
    }
  });

  it('PR-08 a browser may report every type but late_sync and note', () => {
    expect(CLIENT_EVENT_TYPES).toEqual(PROCTOR_EVENT_TYPES.filter((t) => t !== 'late_sync' && t !== 'note'));
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
