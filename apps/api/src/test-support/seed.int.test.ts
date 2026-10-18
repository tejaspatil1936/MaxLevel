import { beforeAll, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from './emulators';
import { SCENARIOS } from './scenarios';
import { emailKey, seedBase, SEED } from './seed';

const { db } = initFirebase();

describe('base seed', () => {
  beforeAll(async () => {
    await clearEmulators();
    await seedBase(db, 1_700_000_000_000);
  });

  it('creates orgs A and B with admins, departments and 20 registered students each', async () => {
    for (const orgId of [SEED.orgA, SEED.orgB]) {
      const org = db.doc(`organizations/${orgId}`);
      expect((await org.get()).data()?.status).toBe('active');
      expect((await org.collection('admins').get()).size).toBe(2);
      expect((await org.collection('students').where('status', '==', 'registered').get()).size).toBe(20);
      expect((await org.collection('departments').get()).size).toBeGreaterThan(1);
    }
  });

  it('indexes an email that is whitelisted in both orgs', async () => {
    const idx = await db.doc(`emailIndex/${emailKey(SEED.multiOrg)}`).get();
    expect(idx.data()?.orgIds).toEqual([SEED.orgA, SEED.orgB]);
  });

  it('SER-01 the authoring-series scenario seeds a draft series with every system default, merged with the body', async () => {
    const { seriesId } = await SCENARIOS['authoring-series']!(db, 5, {
      orgId: SEED.orgB,
      title: 'Placement 2026 COEP',
      defaults: { maxStrikes: 4 },
      eligibility: { graduationYears: [2027] },
    });
    const stored = (await db.doc(`organizations/${SEED.orgB}/series/${seriesId}`).get()).data();
    expect(stored).toMatchObject({
      orgId: SEED.orgB,
      title: 'Placement 2026 COEP',
      status: 'draft',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      dailyWindow: { startMinutes: 600, endMinutes: 660 },
      defaults: { timingMode: 'fixed', maxStrikes: 4, resultDetail: 'sections', seriesLeaderboard: false },
      eligibility: { departmentIds: [], graduationYears: [2027], include: [], exclude: [] },
    });
    expect(Object.keys(stored!.defaults as object)).toHaveLength(16);
  });
});
