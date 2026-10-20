import { NO_RESTRICTION } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const input = {
  title: 'Placement 2026',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dailyWindow: { startMinutes: 600, endMinutes: 660 },
  defaults: { maxStrikes: 4 },
  eligibility: NO_RESTRICTION,
};

beforeEach(async () => {
  await clearEmulators();
});

describe('series data access', () => {
  it('SER-01 SER-02 a created series is stored in its org as a draft with its fields, and nothing undefined', async () => {
    const batch = db.batch();
    const id = data.series.createSeries('org-a', batch, { ...input, description: undefined }, 1000);
    await batch.commit();
    const stored = (await db.doc(`organizations/org-a/series/${id}`).get()).data();
    expect(stored).toEqual({ orgId: 'org-a', ...input, status: 'draft', createdAt: 1000, updatedAt: 1000 });
    expect(await data.series.getSeries('org-a', id)).toMatchObject({ id, status: 'draft', title: 'Placement 2026' });
    expect(await data.series.getSeries('org-b', id)).toBeNull();
  });

  it('SER-02 updates change the status and fields, and lists filter by status with test counts', async () => {
    const batch = db.batch();
    const a = data.series.createSeries('org-a', batch, input, 1000);
    const b = data.series.createSeries('org-a', batch, { ...input, title: 'Later', startDate: '2026-12-01' }, 1000);
    batch.set(db.doc('organizations/org-a/tests/t1'), { orgId: 'org-a', seriesId: a });
    batch.set(db.doc('organizations/org-a/tests/t2'), { orgId: 'org-a', seriesId: a });
    await batch.commit();
    const update = db.batch();
    data.series.updateSeries('org-a', update, a, { status: 'active', updatedAt: 2000, description: undefined });
    await update.commit();

    expect((await data.series.listSeries('org-a')).map((s) => s.id)).toEqual([b, a]);
    expect((await data.series.listSeries('org-a', { status: 'active' })).map((s) => s.id)).toEqual([a]);
    expect(await data.series.listSeries('org-b')).toEqual([]);
    const counts = await data.series.countTestsBySeries('org-a');
    expect([counts.get(a), counts.get(b)]).toEqual([2, undefined]);
  });
});
