import { settingsProblems, SYSTEM_DEFAULTS, type SeriesDefaults, type Settings } from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';

// The settings of spec 5.4 as the series form and the test Settings tab edit them (docs/testids/phase-2.md,
// "Settings"). Number fields stay text while edited, so an out-of-range entry can be shown and refused.

export const CHOICES = {
  timingMode: ['fixed', 'flexible'],
  windowEndPolicy: ['full_duration', 'hard_close'],
  devtoolsPolicy: ['block_strike', 'block', 'allow'],
  resultRelease: ['immediate', 'after_close', 'manual', 'never'],
  resultDetail: ['score', 'sections', 'full'],
} as const satisfies { [K in keyof Settings]?: ReadonlyArray<Settings[K]> };
export type ChoiceKey = keyof typeof CHOICES;

export const NUMBER_KEYS = ['durationMin', 'lateEntryCutoffMin', 'maxStrikes'] as const;
export type NumberKey = (typeof NUMBER_KEYS)[number];

export const SWITCH_KEYS = [
  'fullscreenRequired',
  'cameraRequired',
  'secondCamera',
  'shuffleQuestions',
  'shuffleOptions',
  'showPastScores',
  'testLeaderboard',
  'seriesLeaderboard',
] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

/** Every setting of the settings table but the window, in the order the form shows them. */
export const SETTING_KEYS = [
  'timingMode',
  'durationMin',
  'lateEntryCutoffMin',
  'windowEndPolicy',
  'maxStrikes',
  'devtoolsPolicy',
  ...SWITCH_KEYS,
  'resultRelease',
  'resultDetail',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type SettingsDraft = { [K in ChoiceKey]: (typeof CHOICES)[K][number] } & { [K in NumberKey]: string } & {
  [K in SwitchKey]: boolean;
};

/** Late entry applies to fixed slots only, the window end policy to flexible windows only (5.4). */
export function settingShown(key: SettingKey, draft: Pick<SettingsDraft, 'timingMode'>): boolean {
  if (key === 'lateEntryCutoffMin') return draft.timingMode === 'fixed';
  if (key === 'windowEndPolicy') return draft.timingMode === 'flexible';
  return true;
}

export function draftFromSettings(values: Partial<Settings>): SettingsDraft {
  const s = { ...SYSTEM_DEFAULTS, ...values };
  const draft = Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])) as Record<SettingKey, unknown>;
  for (const k of NUMBER_KEYS) draft[k] = String(s[k]);
  return draft as SettingsDraft;
}

const whole = (v: string) => (/^\s*\d+\s*$/.test(v) ? Number(v) : NaN);

/**
 * The stored defaults for a draft. In a fixed slot the duration is the slot length when it is known (5.4).
 * Numbers that do not parse are left out; settingErrors reports them first.
 */
export function settingsFromDraft(draft: SettingsDraft, slotMinutes?: number | null): SeriesDefaults {
  const out: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) {
    if ((NUMBER_KEYS as readonly string[]).includes(k)) {
      const n = whole(draft[k as NumberKey]);
      if (!Number.isNaN(n)) out[k] = n;
    } else out[k] = draft[k];
  }
  if (draft.timingMode === 'fixed' && slotMinutes) out.durationMin = slotMinutes;
  return out as SeriesDefaults;
}

export type SettingErrors = Partial<Record<SettingKey, MessageKey>>;

/** Field errors of a draft; the SER-09 combination is reported on Result release. */
export function settingErrors(draft: SettingsDraft): SettingErrors {
  const errors: SettingErrors = {};
  const strikes = whole(draft.maxStrikes);
  if (!(strikes >= 1 && strikes <= 10)) errors.maxStrikes = 'setting.strikesError';
  const minutes = (k: NumberKey) => {
    const n = whole(draft[k]);
    if (!(n >= 1 && n <= 1440)) errors[k] = 'setting.minutesError';
  };
  if (draft.timingMode === 'flexible') minutes('durationMin');
  else minutes('lateEntryCutoffMin');
  if (settingsProblems(settingsFromDraft(draft)).length) errors.resultRelease = 'setting.fullReviewBlocked';
  return errors;
}
