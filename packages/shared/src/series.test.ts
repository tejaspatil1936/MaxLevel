import { describe, expect, it } from 'vitest';
import { NO_RESTRICTION } from './eligibility';
import { isoDateSchema, seriesCreateSchema, seriesPatchSchema } from './series';
import { testCreateSchema, testPatchSchema } from './test-record';

const series = {
  title: 'Placement 2026',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dailyWindow: { startMinutes: 600, endMinutes: 660 },
};

describe('series schemas', () => {
  it('SER-01 a new series takes empty defaults and no eligibility restriction when they are left out', () => {
    expect(seriesCreateSchema.parse(series)).toMatchObject({ defaults: {}, eligibility: NO_RESTRICTION });
  });

  it('SER-01 refuses an empty title, an end before the start, an unreal date and a daily end before its start', () => {
    const issues = (input: unknown) => seriesCreateSchema.safeParse(input).error?.issues.map((i) => i.message);
    expect(issues({ ...series, title: '  ' })).toEqual(['Enter the series title.']);
    expect(issues({ ...series, endDate: '2026-10-31' })).toEqual(["The end date can't be before the start date."]);
    expect(isoDateSchema.safeParse('2026-11-31').success).toBe(false);
    expect(issues({ ...series, dailyWindow: { startMinutes: 660, endMinutes: 600 } })).toEqual([
      'The daily end time must be after the start time.',
    ]);
  });

  it('SER-01 series defaults hold every setting but the window', () => {
    expect(seriesCreateSchema.safeParse({ ...series, defaults: { window: null } }).success).toBe(false);
    expect(seriesPatchSchema.safeParse({ defaults: { maxStrikes: 4 } }).success).toBe(true);
  });
});

describe('test schemas', () => {
  it('TST-01 a new test needs a series, a title and a real scheduled date; the day label is optional', () => {
    const t = testCreateSchema.parse({ seriesId: 's1', title: 'Quantitative aptitude', scheduledDate: '2026-11-02' });
    expect(t).toEqual({
      seriesId: 's1',
      title: 'Quantitative aptitude',
      scheduledDate: '2026-11-02',
      dayHidden: false,
    });
    expect(testCreateSchema.safeParse({ seriesId: 's1', title: '', scheduledDate: '2026-11-02' }).success).toBe(false);
  });

  it('TST-04 the status cannot be set through PATCH', () => {
    expect(testPatchSchema.safeParse({ status: 'scheduled' }).success).toBe(false);
    expect(testPatchSchema.safeParse({}).success).toBe(false);
    expect(testPatchSchema.safeParse({ overrides: { maxStrikes: 5 } }).success).toBe(true);
  });
});
