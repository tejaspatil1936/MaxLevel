import { describe, expect, it } from 'vitest';
import { draftFromSettings, settingErrors, settingShown, settingsFromDraft } from './settings-draft';

describe('settings draft', () => {
  it('SER-01 a new draft holds every system default, and saves back as the same values', () => {
    const draft = draftFromSettings({});
    expect(draft).toMatchObject({ timingMode: 'fixed', durationMin: '60', maxStrikes: '3', secondCamera: false });
    expect(settingsFromDraft(draft)).toEqual({
      timingMode: 'fixed',
      durationMin: 60,
      lateEntryCutoffMin: 15,
      windowEndPolicy: 'full_duration',
      maxStrikes: 3,
      devtoolsPolicy: 'block_strike',
      fullscreenRequired: true,
      cameraRequired: true,
      secondCamera: false,
      audioProctoring: true,
      shuffleQuestions: true,
      shuffleOptions: true,
      showPastScores: true,
      testLeaderboard: false,
      seriesLeaderboard: false,
      resultRelease: 'after_close',
      resultDetail: 'sections',
    });
    expect(Object.keys(settingErrors(draft))).toEqual([]);
  });

  it('SER-01 a fixed slot stores the slot length as its duration; late entry and window end apply by mode', () => {
    const fixed = draftFromSettings({ durationMin: 90 });
    expect(settingsFromDraft(fixed, 120).durationMin).toBe(120);
    expect(settingsFromDraft({ ...fixed, timingMode: 'flexible' }, 120).durationMin).toBe(90);
    expect(settingShown('lateEntryCutoffMin', fixed)).toBe(true);
    expect(settingShown('windowEndPolicy', fixed)).toBe(false);
    expect(settingShown('windowEndPolicy', { timingMode: 'flexible' })).toBe(true);
  });

  it('SER-01 strikes outside 1 to 10 and minutes below 1 or not whole are field errors', () => {
    const draft = draftFromSettings({ timingMode: 'flexible' });
    expect(settingErrors({ ...draft, maxStrikes: '11' })).toEqual({ maxStrikes: 'setting.strikesError' });
    expect(settingErrors({ ...draft, maxStrikes: '2.5' })).toEqual({ maxStrikes: 'setting.strikesError' });
    expect(settingErrors({ ...draft, durationMin: '0' })).toEqual({ durationMin: 'setting.minutesError' });
    expect(settingErrors({ ...draft, durationMin: '' })).toEqual({ durationMin: 'setting.minutesError' });
    expect(settingErrors({ ...draft, timingMode: 'fixed', lateEntryCutoffMin: 'x' })).toEqual({
      lateEntryCutoffMin: 'setting.minutesError',
    });
  });

  it('SER-09 a flexible window with a full review on submit is an error on Result release; a manual release is not', () => {
    const leaky = draftFromSettings({ timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' });
    expect(settingErrors(leaky)).toEqual({ resultRelease: 'setting.fullReviewBlocked' });
    expect(settingErrors({ ...leaky, resultRelease: 'manual' })).toEqual({});
    expect(settingErrors({ ...leaky, timingMode: 'fixed' })).toEqual({});
  });
});
