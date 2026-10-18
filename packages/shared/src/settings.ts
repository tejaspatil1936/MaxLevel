import { z } from 'zod';
import { MARKING_PRESET_IDS } from './marks';

// Test settings (spec 5.4). Stored keys follow PLAN section 5 `Settings`; times are epoch ms, UTC (TST-07).

/** A series' daily time range, in minutes after midnight in the organization's timezone. */
export const dailyWindowSchema = z
  .object({ startMinutes: z.number().int().min(0).max(1439), endMinutes: z.number().int().min(1).max(1440) })
  .refine((w) => w.endMinutes > w.startMinutes, {
    message: 'The daily end time must be after the start time.',
    path: ['endMinutes'],
  });
export type DailyWindow = z.infer<typeof dailyWindowSchema>;

export const windowSchema = z
  .object({ start: z.number().int(), end: z.number().int() })
  .refine((w) => w.end > w.start, { message: 'The window must end after it starts.', path: ['end'] });
export type TimeWindow = z.infer<typeof windowSchema>;

export const markingSchema = z.object({
  marks: z.number().positive().max(1000),
  negativeMarks: z.number().min(0).max(1000),
  preset: z.enum(MARKING_PRESET_IDS),
});
export type Marking = z.infer<typeof markingSchema>;

const minutes = z.number().int().min(1).max(1440);
const settingsShape = {
  timingMode: z.enum(['fixed', 'flexible']),
  window: windowSchema.nullable(),
  durationMin: minutes,
  lateEntryCutoffMin: minutes,
  windowEndPolicy: z.enum(['full_duration', 'hard_close']),
  maxStrikes: z.number().int().min(1).max(10),
  devtoolsPolicy: z.enum(['block_strike', 'block', 'allow']),
  fullscreenRequired: z.boolean(),
  cameraRequired: z.boolean(),
  secondCamera: z.boolean(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  resultRelease: z.enum(['immediate', 'after_close', 'manual', 'never']),
  resultDetail: z.enum(['score', 'sections', 'full']),
  showPastScores: z.boolean(),
  testLeaderboard: z.boolean(),
  seriesLeaderboard: z.boolean(),
  marking: markingSchema,
  passingMarks: z.number().min(0).optional(),
  floorAtZero: z.boolean(),
  /** Per-question time limit (Q-10): none, the same for every question, or set on each question. */
  questionTimeMode: z.enum(['none', 'same', 'each']),
  questionTimeLimitSec: z.number().int().min(1).max(3600).optional(),
};
export const settingsSchema = z.object(settingsShape);
export type Settings = z.infer<typeof settingsSchema>;

/** A test's overrides: only the overridden keys (TST-03). */
export const settingsOverridesSchema = z.object(settingsShape).partial().strict();
export type SettingsOverrides = z.infer<typeof settingsOverridesSchema>;
/** A series' defaults: every setting but the window, which a series sets as `dailyWindow`. */
export const seriesDefaultsSchema = settingsOverridesSchema.omit({ window: true });
export type SeriesDefaults = z.infer<typeof seriesDefaultsSchema>;

export const SYSTEM_DEFAULTS: Omit<Settings, 'window'> = {
  timingMode: 'fixed',
  durationMin: 60,
  lateEntryCutoffMin: 15,
  windowEndPolicy: 'full_duration',
  maxStrikes: 3,
  devtoolsPolicy: 'block_strike',
  fullscreenRequired: true,
  cameraRequired: true,
  secondCamera: false,
  shuffleQuestions: true,
  shuffleOptions: true,
  resultRelease: 'after_close',
  resultDetail: 'sections',
  showPastScores: true,
  testLeaderboard: false,
  seriesLeaderboard: false,
  marking: { marks: 1, negativeMarks: 0, preset: 'p1_0' },
  floorAtZero: false,
  questionTimeMode: 'none',
};

/** Release and visibility settings: editing them never sends an approved test back to review (Q-15, TST-06). */
export const RELEASE_SETTING_KEYS = [
  'resultRelease',
  'resultDetail',
  'showPastScores',
  'testLeaderboard',
  'seriesLeaderboard',
] as const satisfies ReadonlyArray<keyof Settings>;

/** Offset of a timezone from UTC at an instant, in ms (positive east of UTC). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcMs);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - (utcMs - (((utcMs % 1000) + 1000) % 1000));
}

/** Epoch ms (UTC) of a wall-clock time: `minutes` after midnight of `date` (yyyy-mm-dd) in `timeZone`. */
export function zonedTimeToUtc(date: string, minutesAfterMidnight: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutesAfterMidnight);
  const first = wall - zoneOffsetMs(wall, timeZone);
  // Near a daylight-saving change the offset at the result can differ from the offset at the first guess.
  return wall - zoneOffsetMs(first, timeZone);
}

const defined = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * The settings in force for a test: the test override, then the series default, then the system default (spec 5).
 * The window is the test's own, else the series daily window on the scheduled date in the org timezone, else null.
 * In fixed slot mode the duration is the slot length (5.4); the per-question limit only applies in `same` mode.
 */
export function resolveSettings(input: {
  series: { defaults: Partial<Settings>; dailyWindow?: DailyWindow | null };
  test: { overrides: Partial<Settings>; scheduledDate: string };
  timezone: string;
}): Settings {
  const { series, test, timezone } = input;
  const { window: _seriesWindow, ...seriesDefaults } = defined(series.defaults);
  const overrides = defined(test.overrides);
  const window =
    overrides.window ??
    (series.dailyWindow
      ? {
          start: zonedTimeToUtc(test.scheduledDate, series.dailyWindow.startMinutes, timezone),
          end: zonedTimeToUtc(test.scheduledDate, series.dailyWindow.endMinutes, timezone),
        }
      : null);
  const settings: Settings = { ...SYSTEM_DEFAULTS, ...seriesDefaults, ...overrides, window };
  if (settings.timingMode === 'fixed' && window)
    settings.durationMin = Math.round((window.end - window.start) / 60_000);
  if (settings.questionTimeMode !== 'same') delete settings.questionTimeLimitSec;
  return settings;
}

/**
 * SER-09: in a flexible window, a full review released on submit would show the answers to students who haven't
 * started yet. Missing keys take the system defaults.
 */
export function settingsProblems(
  settings: Partial<Settings>,
): Array<{ code: 'FULL_REVIEW_BEFORE_CLOSE'; field: 'resultRelease' }> {
  const s = { ...SYSTEM_DEFAULTS, ...defined(settings) };
  return s.timingMode === 'flexible' && s.resultDetail === 'full' && s.resultRelease === 'immediate'
    ? [{ code: 'FULL_REVIEW_BEFORE_CLOSE', field: 'resultRelease' }]
    : [];
}

export const FULL_REVIEW_BEFORE_CLOSE_MESSAGE =
  "In a flexible window, a full review released on submit would show the answers to students who haven't started yet. Release results after the window closes, or choose a lower detail level.";
