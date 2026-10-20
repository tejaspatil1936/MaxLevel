import { NO_RESTRICTION, type Series } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { detailErrors, initialSeriesForm, seriesBody, slotMinutes } from './series-form';

const details = {
  title: ' Placement drive 2026 ',
  description: '',
  startDate: '2026-11-01',
  endDate: '2026-11-20',
  dailyStart: '09:00',
  dailyEnd: '18:00',
};
const stored: Series = {
  id: 's1',
  title: 'Placement 2026',
  status: 'draft',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dailyWindow: { startMinutes: 600, endMinutes: 660 },
  defaults: { maxStrikes: 4, marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' } },
  eligibility: { ...NO_RESTRICTION, include: ['stu-1'] },
  testCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

describe('series form', () => {
  it('SER-01 a missing title, an end before the start and a daily end before its start are field errors', () => {
    expect(detailErrors(details)).toEqual({});
    expect(detailErrors({ ...details, title: ' ', endDate: '2026-10-31', dailyEnd: '08:00' })).toEqual({
      title: 'series.titleMissing',
      endDate: 'series.endBeforeStart',
      dailyEnd: 'series.dailyEndBeforeStart',
    });
    expect(detailErrors({ ...details, startDate: '', endDate: '', dailyStart: '', dailyEnd: '' })).toEqual({
      startDate: 'series.startMissing',
      endDate: 'series.endMissing',
      dailyStart: 'series.dailyStartMissing',
      dailyEnd: 'series.dailyEndMissing',
    });
  });

  it('SER-01 a new series sends its details, the daily window in minutes and every default setting', () => {
    const state = { ...initialSeriesForm(), details };
    const body = seriesBody(state, NO_RESTRICTION);
    expect(body).toMatchObject({
      title: 'Placement drive 2026',
      startDate: '2026-11-01',
      endDate: '2026-11-20',
      dailyWindow: { startMinutes: 540, endMinutes: 1080 },
      defaults: { timingMode: 'fixed', durationMin: 540, maxStrikes: 3, resultDetail: 'sections' },
      eligibility: NO_RESTRICTION,
    });
    expect(body).not.toHaveProperty('description');
    expect(slotMinutes(details)).toBe(540);
  });

  it('SER-01 an edit starts from the stored values and keeps stored defaults the form does not show', () => {
    const state = initialSeriesForm(stored, [{ id: 'stu-1', email: 'student01@a.test', prn: 'P1' }]);
    expect(state.details).toMatchObject({ dailyStart: '10:00', dailyEnd: '11:00', description: '' });
    expect(state.settings.maxStrikes).toBe('4');
    expect(state.eligibility.include).toBe('student01@a.test');
    const body = seriesBody(state, stored.eligibility, stored);
    expect(body.description).toBe('');
    expect(body.defaults).toMatchObject({ maxStrikes: 4, durationMin: 60, marking: stored.defaults.marking });
  });
});
