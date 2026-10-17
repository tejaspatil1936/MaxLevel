import { beforeAll, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from './emulators';
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
});
