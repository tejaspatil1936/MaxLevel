import { SYSTEM_DEFAULTS } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import {
  initialTestSettings,
  localInput,
  overridesFromState,
  parseLocalInput,
  seriesSettings,
  setOverridden,
  testSettingErrors,
} from './test-settings';

const TZ = 'Asia/Kolkata';
const series = { defaults: { ...SYSTEM_DEFAULTS, maxStrikes: 4 }, dailyWindow: { startMinutes: 600, endMinutes: 660 } };
const base = seriesSettings(series, '2026-11-02', TZ);
/** 2 Nov 2026 in IST as UTC ms. */
const ist = (h: number, m = 0) => Date.UTC(2026, 10, 2, h, m) - 330 * 60_000;

describe('test settings tab', () => {
  it('TST-03 US-AD-05 a test with no overrides inherits every series value, the window included', () => {
    const state = initialTestSettings(base, {}, TZ);
    expect(state.overridden).toEqual([]);
    expect(state.draft).toMatchObject({ maxStrikes: '4', durationMin: '60', shuffleQuestions: true });
    expect(state.window).toEqual({ start: '2026-11-02T10:00', end: '2026-11-02T11:00' });
    expect(overridesFromState(state, {}, base, TZ)).toEqual({});
  });

  it('TST-03 overriding starts from the series value; a reset puts it back and drops the key', () => {
    let state = initialTestSettings(base, { shuffleQuestions: false }, TZ);
    expect(state.overridden).toEqual(['shuffleQuestions']);
    state = setOverridden(state, 'maxStrikes', true, base, TZ);
    expect(state.draft.maxStrikes).toBe('4');
    state = { ...state, draft: { ...state.draft, maxStrikes: '7' } };
    expect(overridesFromState(state, {}, base, TZ)).toEqual({ maxStrikes: 7, shuffleQuestions: false });
    state = setOverridden(state, 'maxStrikes', false, base, TZ);
    expect(state.draft.maxStrikes).toBe('4');
    expect(overridesFromState(state, {}, base, TZ)).toEqual({ shuffleQuestions: false });
  });

  it('TST-03 overrides other tabs own, such as marking, are kept on save', () => {
    const marking = { marks: 4, negativeMarks: 1, preset: 'p4_m1' } as const;
    const state = initialTestSettings(base, { marking, questionTimeMode: 'each' }, TZ);
    expect(state.overridden).toEqual([]);
    expect(overridesFromState(state, { marking, questionTimeMode: 'each' }, base, TZ)).toEqual({
      marking,
      questionTimeMode: 'each',
    });
  });

  it('TST-03 TST-07 a window override is typed in the org timezone and stored in UTC ms', () => {
    expect(parseLocalInput('2026-11-02T14:00', TZ)).toBe(ist(14));
    expect(localInput(ist(15, 30), TZ)).toBe('2026-11-02T15:30');
    expect(parseLocalInput('', TZ)).toBeNull();
    let state = setOverridden(initialTestSettings(base, {}, TZ), 'window', true, base, TZ);
    state = { ...state, window: { start: '2026-11-02T14:00', end: '2026-11-02T15:30' } };
    expect(testSettingErrors(state, TZ)).toEqual({});
    expect(overridesFromState(state, {}, base, TZ)).toEqual({ window: { start: ist(14), end: ist(15, 30) } });
    expect(initialTestSettings(base, { window: { start: ist(14), end: ist(15, 30) } }, TZ).window).toEqual(
      state.window,
    );
    state = { ...state, window: { ...state.window, end: '2026-11-02T13:00' } };
    expect(testSettingErrors(state, TZ)).toEqual({ windowEnd: 'setting.windowError' });
  });

  it('TST-03 SER-09 only overridden values are checked, and the leaky release combination always is', () => {
    let state = setOverridden(initialTestSettings(base, {}, TZ), 'maxStrikes', true, base, TZ);
    state = { ...state, draft: { ...state.draft, maxStrikes: '11' } };
    expect(testSettingErrors(state, TZ)).toEqual({ maxStrikes: 'setting.strikesError' });
    const flexible = seriesSettings(
      { ...series, defaults: { ...series.defaults, timingMode: 'flexible', resultDetail: 'full' } },
      '2026-11-02',
      TZ,
    );
    state = setOverridden(initialTestSettings(flexible, {}, TZ), 'resultRelease', true, flexible, TZ);
    state = { ...state, draft: { ...state.draft, resultRelease: 'immediate' } };
    expect(testSettingErrors(state, TZ)).toEqual({ resultRelease: 'setting.fullReviewBlocked' });
  });
});
