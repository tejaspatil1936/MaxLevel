import type { EligibilityRules, Series, SeriesCreate } from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';
import { formatMinutes, parseMinutes } from '@/lib/format';
import {
  draftFromRules,
  EMPTY_ELIGIBILITY,
  type EligibilityDraft,
  type StudentRef,
} from '../eligibility/eligibility-draft';
import { draftFromSettings, settingsFromDraft, type SettingsDraft } from '../settings/settings-draft';

// The New series and Edit series form (docs/testids/phase-2.md, "New series and Edit series").

export interface SeriesDetails {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  dailyStart: string;
  dailyEnd: string;
}
export interface SeriesFormState {
  details: SeriesDetails;
  settings: SettingsDraft;
  eligibility: EligibilityDraft;
}

/** Blank details with system defaults (new), or the stored values (edit). */
export function initialSeriesForm(series?: Series, students: readonly StudentRef[] = []): SeriesFormState {
  if (!series)
    return {
      details: { title: '', description: '', startDate: '', endDate: '', dailyStart: '', dailyEnd: '' },
      settings: draftFromSettings({}),
      eligibility: EMPTY_ELIGIBILITY,
    };
  return {
    details: {
      title: series.title,
      description: series.description ?? '',
      startDate: series.startDate,
      endDate: series.endDate,
      dailyStart: series.dailyWindow ? formatMinutes(series.dailyWindow.startMinutes) : '',
      dailyEnd: series.dailyWindow ? formatMinutes(series.dailyWindow.endMinutes) : '',
    },
    settings: draftFromSettings(series.defaults),
    eligibility: draftFromRules(series.eligibility, students),
  };
}

/** The fixed-slot length the daily times give, when both are set and in order. */
export function slotMinutes(d: Pick<SeriesDetails, 'dailyStart' | 'dailyEnd'>): number | null {
  const start = parseMinutes(d.dailyStart);
  const end = parseMinutes(d.dailyEnd);
  return start !== null && end !== null && end > start ? end - start : null;
}

export type DetailErrors = Partial<Record<keyof SeriesDetails, MessageKey>>;

export function detailErrors(d: SeriesDetails): DetailErrors {
  const e: DetailErrors = {};
  if (!d.title.trim()) e.title = 'series.titleMissing';
  if (!d.startDate) e.startDate = 'series.startMissing';
  if (!d.endDate) e.endDate = 'series.endMissing';
  else if (d.startDate && d.endDate < d.startDate) e.endDate = 'series.endBeforeStart';
  if (parseMinutes(d.dailyStart) === null) e.dailyStart = 'series.dailyStartMissing';
  if (parseMinutes(d.dailyEnd) === null) e.dailyEnd = 'series.dailyEndMissing';
  else if (!e.dailyStart && !slotMinutes(d)) e.dailyEnd = 'series.dailyEndBeforeStart';
  return e;
}

/**
 * The request body for a valid form. Stored defaults the form does not show (marking, for example) are kept, so an
 * edit never drops them.
 */
export function seriesBody(
  state: SeriesFormState,
  eligibility: EligibilityRules,
  stored?: Series,
): Required<Omit<SeriesCreate, 'description'>> & { description?: string } {
  const { details: d } = state;
  const { window: _w, ...kept } = stored?.defaults ?? {};
  const description = d.description.trim();
  return {
    title: d.title.trim(),
    ...(description || stored ? { description } : {}),
    startDate: d.startDate,
    endDate: d.endDate,
    dailyWindow: { startMinutes: parseMinutes(d.dailyStart)!, endMinutes: parseMinutes(d.dailyEnd)! },
    defaults: { ...kept, ...settingsFromDraft(state.settings, slotMinutes(d)) },
    eligibility,
  };
}
