import { MARKING_PRESETS, presetFor, type MarkingPreset, type Settings, type SettingsOverrides } from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';

// The Marking and timers tab (Q-08, Q-10). Values stay text while typed. A preset only fills in values that stay
// editable, and values that match no preset are Custom. Saving changes only the override keys this tab owns.

export type TimeMode = Settings['questionTimeMode'];

export interface MarkingDraft {
  preset: MarkingPreset;
  marks: string;
  negativeMarks: string;
  timeMode: TimeMode;
  seconds: string;
}

export type MarkingField = 'marks' | 'negativeMarks' | 'seconds';
export type MarkingErrors = Partial<Record<MarkingField, MessageKey>>;

/** The override keys this tab owns; the Settings tab keeps them as they are. */
const OWN_KEYS = ['marking', 'questionTimeMode', 'questionTimeLimitSec'] as const;

/** The tab starts from the settings in force for the test. */
export function markingDraft(s: Pick<Settings, 'marking' | 'questionTimeMode' | 'questionTimeLimitSec'>): MarkingDraft {
  return {
    preset: s.marking.preset,
    marks: String(s.marking.marks),
    negativeMarks: String(s.marking.negativeMarks),
    timeMode: s.questionTimeMode,
    seconds: s.questionTimeLimitSec === undefined ? '' : String(s.questionTimeLimitSec),
  };
}

/** Choosing a preset fills both values; choosing Custom keeps them. */
export function choosePreset(d: MarkingDraft, preset: MarkingPreset): MarkingDraft {
  if (preset === 'custom') return { ...d, preset };
  const p = MARKING_PRESETS[preset];
  return { ...d, preset, marks: String(p.marks), negativeMarks: String(p.negativeMarks) };
}

const parsed = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** An edited value selects the preset it now matches, else Custom (Q-08). */
export function editValue(d: MarkingDraft, field: 'marks' | 'negativeMarks', value: string): MarkingDraft {
  const next = { ...d, [field]: value };
  const marks = parsed(next.marks);
  const negative = parsed(next.negativeMarks);
  const preset = Number.isFinite(marks) && Number.isFinite(negative) ? presetFor(marks, negative) : 'custom';
  return { ...next, preset };
}

export function markingErrors(d: MarkingDraft): MarkingErrors {
  const errors: MarkingErrors = {};
  const marks = parsed(d.marks);
  if (!(marks > 0)) errors.marks = 'marking.marksInvalid';
  else if (marks > 1000) errors.marks = 'marking.marksTooLarge';
  const negative = parsed(d.negativeMarks);
  if (!(negative >= 0)) errors.negativeMarks = 'marking.negativeInvalid';
  else if (negative > 1000) errors.negativeMarks = 'marking.marksTooLarge';
  if (d.timeMode === 'same') {
    const seconds = parsed(d.seconds);
    if (!(Number.isInteger(seconds) && seconds >= 1)) errors.seconds = 'marking.secondsInvalid';
    else if (seconds > 3600) errors.seconds = 'marking.secondsTooLarge';
  }
  return errors;
}

/**
 * The override map to store: the stored overrides of other tabs, then this tab's values. Marking and the time-limit
 * mode are stored when they were overridden already or differ from the series; seconds only with `same` (Q-10).
 */
export function markingOverrides(d: MarkingDraft, stored: SettingsOverrides, series: Settings): SettingsOverrides {
  const out: SettingsOverrides = Object.fromEntries(
    Object.entries(stored).filter(([k, v]) => !(OWN_KEYS as readonly string[]).includes(k) && v != null),
  );
  const marking = { marks: Number(d.marks), negativeMarks: Number(d.negativeMarks), preset: d.preset };
  const sm = series.marking;
  const sameAsSeries =
    sm.marks === marking.marks && sm.negativeMarks === marking.negativeMarks && sm.preset === d.preset;
  if (stored.marking || !sameAsSeries) out.marking = marking;
  if (stored.questionTimeMode || d.timeMode !== series.questionTimeMode || d.timeMode === 'same')
    out.questionTimeMode = d.timeMode;
  if (d.timeMode === 'same') out.questionTimeLimitSec = Number(d.seconds);
  return out;
}
