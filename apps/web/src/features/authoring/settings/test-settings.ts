import {
  resolveSettings,
  zonedTimeToUtc,
  type Settings,
  type SettingsOverrides,
  type TimeWindow,
} from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';
import { zonedParts } from '@/lib/format';
import {
  draftFromSettings,
  SETTING_KEYS,
  settingErrors,
  settingsFromDraft,
  type SettingKey,
  type SettingsDraft,
} from './settings-draft';

// The test editor's Settings tab (TST-03, US-AD-05): each setting is inherited from the series or overridden for
// this test. Inherited settings always show the series' current value; stored overrides hold only overridden keys.

export type OverrideKey = SettingKey | 'window';
/** The tab's settings in order: the settings table with `Window` in place of the series' daily times. */
export const TEST_SETTING_KEYS: readonly OverrideKey[] = [SETTING_KEYS[0], 'window', ...SETTING_KEYS.slice(1)];

/** Window start and end as `datetime-local` values, wall-clock times in the organization's timezone. */
export interface WindowDraft {
  start: string;
  end: string;
}

export interface TestSettingsState {
  /** Overridden keys, in tab order. */
  overridden: OverrideKey[];
  /** Every setting's value: the override where overridden, else the series value. */
  draft: SettingsDraft;
  window: WindowDraft;
}

/** What the test gets from its series alone: series defaults, then system defaults, and the daily window. */
export function seriesSettings(
  series: { defaults: Partial<Settings>; dailyWindow?: { startMinutes: number; endMinutes: number } | null },
  scheduledDate: string,
  timezone: string,
): Settings {
  return resolveSettings({ series, test: { overrides: {}, scheduledDate }, timezone });
}

/** An instant as a `datetime-local` value in a timezone. */
export function localInput(ms: number, timeZone: string): string {
  const { day, time } = zonedParts(ms, timeZone);
  return `${day}T${time}`;
}

/** A `datetime-local` value, read as wall-clock time in a timezone, as epoch ms; null when not a date-time. */
export function parseLocalInput(value: string, timeZone: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return zonedTimeToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), timeZone);
}

const windowDraft = (w: TimeWindow | null, timeZone: string): WindowDraft =>
  w ? { start: localInput(w.start, timeZone), end: localInput(w.end, timeZone) } : { start: '', end: '' };

const isOverride = (k: string): k is OverrideKey => (TEST_SETTING_KEYS as readonly string[]).includes(k);

export function initialTestSettings(base: Settings, overrides: Partial<Settings>, timeZone: string): TestSettingsState {
  const own = Object.fromEntries(Object.entries(overrides).filter(([k, v]) => isOverride(k) && v != null));
  return {
    overridden: TEST_SETTING_KEYS.filter((k) => k in own),
    draft: draftFromSettings({ ...base, ...own }),
    window: windowDraft((own.window as TimeWindow | undefined) ?? base.window, timeZone),
  };
}

/**
 * Switches a setting to Overridden (its control prefilled with the series value) or back to Inherited, which puts
 * the series value back.
 */
export function setOverridden(
  state: TestSettingsState,
  key: OverrideKey,
  on: boolean,
  base: Settings,
  timeZone: string,
): TestSettingsState {
  const overridden = TEST_SETTING_KEYS.filter((k) => (k === key ? on : state.overridden.includes(k)));
  if (key === 'window') return { ...state, overridden, window: windowDraft(base.window, timeZone) };
  const seriesValue = draftFromSettings(base)[key];
  return { ...state, overridden, draft: { ...state.draft, [key]: seriesValue } };
}

/** The window in force while editing: the typed override when it parses, else the series window. */
export function draftWindow(state: TestSettingsState, base: Settings, timeZone: string): TimeWindow | null {
  if (!state.overridden.includes('window')) return base.window;
  const start = parseLocalInput(state.window.start, timeZone);
  const end = parseLocalInput(state.window.end, timeZone);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

export type TestSettingErrors = Partial<Record<SettingKey | 'windowStart' | 'windowEnd', MessageKey>>;

/**
 * Field errors of the overridden settings. The SER-09 combination is judged on the settings as resolved, so it is
 * reported on Result release whether or not that setting is overridden.
 */
export function testSettingErrors(state: TestSettingsState, timeZone: string): TestSettingErrors {
  const all = settingErrors(state.draft);
  const errors: TestSettingErrors = {};
  for (const k of state.overridden) if (k !== 'window' && all[k]) errors[k] = all[k];
  if (all.resultRelease === 'setting.fullReviewBlocked') errors.resultRelease = all.resultRelease;
  if (state.overridden.includes('window')) {
    const start = parseLocalInput(state.window.start, timeZone);
    const end = parseLocalInput(state.window.end, timeZone);
    if (start === null) errors.windowStart = 'setting.windowMissing';
    if (end === null) errors.windowEnd = 'setting.windowMissing';
    else if (start !== null && end <= start) errors.windowEnd = 'setting.windowError';
  }
  return errors;
}

/**
 * The override map to store: the overridden settings of this tab, plus the stored overrides other tabs own
 * (marking, time limits). A reset setting is left out, so the test follows the series again.
 */
export function overridesFromState(
  state: TestSettingsState,
  stored: Partial<Settings>,
  base: Settings,
  timeZone: string,
): SettingsOverrides {
  // A window override left as loaded keeps its stored instants: the inputs show whole minutes, and a stored window
  // with seconds must not read as an edit, which TST-06 refuses once attempts have started.
  const own = stored.window;
  const untouched =
    !!own &&
    state.overridden.includes('window') &&
    windowDraft(own, timeZone).start === state.window.start &&
    windowDraft(own, timeZone).end === state.window.end;
  const window = untouched ? own : draftWindow(state, base, timeZone);
  const slot = window ? Math.round((window.end - window.start) / 60_000) : null;
  const values: Partial<Settings> = settingsFromDraft(state.draft, slot);
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(stored).filter(([k, v]) => !isOverride(k) && v != null),
  );
  for (const k of state.overridden) {
    if (k === 'window') out.window = window;
    else if (values[k] !== undefined) out[k] = values[k];
  }
  return out as SettingsOverrides;
}
