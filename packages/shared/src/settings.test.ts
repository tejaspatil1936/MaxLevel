import { describe, expect, it } from 'vitest';
import {
  resolveSettings,
  seriesDefaultsSchema,
  settingsOverridesSchema,
  settingsProblems,
  SYSTEM_DEFAULTS,
  withSnapshotFallbacks,
  zonedTimeToUtc,
  type Settings,
} from './settings';

const series = { defaults: {}, dailyWindow: { startMinutes: 600, endMinutes: 660 } };
const test = { overrides: {}, scheduledDate: '2026-11-02' };
const tz = 'Asia/Kolkata';

describe('resolveSettings', () => {
  it('TST-03 with nothing set, every setting takes its system default (spec 5.4)', () => {
    const s = resolveSettings({ series: { defaults: {} }, test, timezone: tz });
    expect(s).toEqual({ ...SYSTEM_DEFAULTS, window: null });
    expect([s.timingMode, s.maxStrikes, s.resultRelease, s.resultDetail]).toEqual([
      'fixed',
      3,
      'after_close',
      'sections',
    ]);
  });

  it('TST-03 the test override wins, then the series default, then the system default', () => {
    const s = resolveSettings({
      series: { ...series, defaults: { maxStrikes: 5, shuffleQuestions: false, resultDetail: 'score' } },
      test: { ...test, overrides: { maxStrikes: 7 } },
      timezone: tz,
    });
    expect([s.maxStrikes, s.shuffleQuestions, s.resultDetail, s.devtoolsPolicy]).toEqual([
      7,
      false,
      'score',
      'block_strike',
    ]);
  });

  it('TST-03 an undefined override falls through to the series value', () => {
    const s = resolveSettings({
      series: { ...series, defaults: { maxStrikes: 5 } },
      test: { ...test, overrides: { maxStrikes: undefined } },
      timezone: tz,
    });
    expect(s.maxStrikes).toBe(5);
  });

  it('TST-07 the window is the series daily window on the scheduled date in the org timezone, in UTC ms', () => {
    const s = resolveSettings({ series, test, timezone: tz });
    expect(s.window).toEqual({ start: Date.UTC(2026, 10, 2, 4, 30), end: Date.UTC(2026, 10, 2, 5, 30) });
    expect(s.durationMin).toBe(60);
  });

  it('TST-07 a timezone with daylight saving uses the offset of that date', () => {
    // New York leaves daylight saving at 02:00 on 1 Nov 2026: 10:00 that day is EST (UTC-5), the day before EDT.
    expect(zonedTimeToUtc('2026-11-01', 600, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 15, 0));
    expect(zonedTimeToUtc('2026-10-31', 600, 'America/New_York')).toBe(Date.UTC(2026, 9, 31, 14, 0));
    expect(zonedTimeToUtc('2026-11-02', 1440, tz)).toBe(Date.UTC(2026, 10, 2, 18, 30));
  });

  it('TST-03 a test window override replaces the daily window, and no window at all resolves to null', () => {
    const own = { start: Date.UTC(2026, 10, 2, 8), end: Date.UTC(2026, 10, 2, 10) };
    expect(resolveSettings({ series, test: { ...test, overrides: { window: own } }, timezone: tz }).window).toEqual(
      own,
    );
    expect(resolveSettings({ series: { defaults: {} }, test, timezone: tz }).window).toBeNull();
  });

  it('TST-03 in fixed slot mode the duration is the slot length; a flexible window keeps its duration', () => {
    const long = { ...series, dailyWindow: { startMinutes: 540, endMinutes: 660 }, defaults: { durationMin: 45 } };
    expect(resolveSettings({ series: long, test, timezone: tz }).durationMin).toBe(120);
    const flexible = { ...long, defaults: { durationMin: 45, timingMode: 'flexible' as const } };
    expect(resolveSettings({ series: flexible, test, timezone: tz }).durationMin).toBe(45);
  });

  it('TST-03 the marking override replaces the whole marking, and a per-question limit applies only in same mode', () => {
    const marking = { marks: 4, negativeMarks: 1, preset: 'p4_m1' as const };
    const same = resolveSettings({
      series,
      test: { ...test, overrides: { marking, questionTimeMode: 'same', questionTimeLimitSec: 60 } },
      timezone: tz,
    });
    expect([same.marking, same.questionTimeMode, same.questionTimeLimitSec]).toEqual([marking, 'same', 60]);
    const each = resolveSettings({
      series,
      test: { ...test, overrides: { questionTimeMode: 'each', questionTimeLimitSec: 60 } },
      timezone: tz,
    });
    expect(each).not.toHaveProperty('questionTimeLimitSec');
  });

  it('TST-03 overrides refuse unknown keys and out-of-range values; series defaults have no window', () => {
    expect(settingsOverridesSchema.safeParse({ maxStrikes: 11 }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ maxStrikes: 2.5 }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ durationMin: 0 }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ colour: 'red' }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ window: { start: 10, end: 5 } }).success).toBe(false);
    expect(seriesDefaultsSchema.safeParse({ window: { start: 1, end: 5 } }).success).toBe(false);
    expect(settingsOverridesSchema.safeParse({ maxStrikes: 10, window: null }).success).toBe(true);
  });
});

describe('settingsProblems', () => {
  it('SER-09 flexible window, full review and release on submit is FULL_REVIEW_BEFORE_CLOSE', () => {
    expect(settingsProblems({ timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' })).toEqual([
      { code: 'FULL_REVIEW_BEFORE_CLOSE', field: 'resultRelease' },
    ]);
  });

  it('SER-09 a lower detail, a release after the window or a manual release, or a fixed slot is allowed', () => {
    const base = { timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' } as const;
    expect(settingsProblems({ ...base, resultDetail: 'sections' })).toEqual([]);
    expect(settingsProblems({ ...base, resultRelease: 'after_close' })).toEqual([]);
    expect(settingsProblems({ ...base, resultRelease: 'manual' })).toEqual([]);
    expect(settingsProblems({ ...base, timingMode: 'fixed' })).toEqual([]);
  });

  it('SER-09 missing keys take the system defaults', () => {
    expect(settingsProblems({})).toEqual([]);
    expect(settingsProblems({ resultDetail: 'full', resultRelease: 'immediate' })).toEqual([]);
  });
});

describe('withSnapshotFallbacks', () => {
  it('TST-05 a snapshot published before voice detection existed keeps it off; a new one keeps its own value', () => {
    const { audioProctoring: _absent, ...old } = { ...SYSTEM_DEFAULTS, window: null };
    expect(withSnapshotFallbacks(old as Settings).audioProctoring).toBe(false);
    expect(withSnapshotFallbacks({ ...SYSTEM_DEFAULTS, window: null }).audioProctoring).toBe(true);
    expect(withSnapshotFallbacks(undefined)).toBeUndefined();
  });

  it('voice detection is on by default for new tests', () => {
    expect(SYSTEM_DEFAULTS.audioProctoring).toBe(true);
  });
});
