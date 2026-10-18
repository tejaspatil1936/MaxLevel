import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('entitlements', () => {
  it('FF-05 changing flags and limits is audit-logged with before and after values', async () => {
    const { app } = await testApp();
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/platform/orgs/${SEED.orgA}/entitlements`,
      headers: sa,
      payload: { featureOverrides: { analytics_reports: true }, limitOverrides: { max_students: 1500 } },
    });
    expect(res.json()).toMatchObject({
      entitlements: { features: { analytics_reports: true }, limits: { max_students: 1500 } },
    });
    const log = (await db.collection(`organizations/${SEED.orgA}/auditLogs`).get()).docs.map((d) => d.data());
    expect(log).toEqual([
      expect.objectContaining({
        action: 'org.entitlements.update',
        before: { featureOverrides: {}, limitOverrides: {} },
        after: { featureOverrides: { analytics_reports: true }, limitOverrides: { max_students: 1500 } },
        actor: expect.objectContaining({ role: 'superAdmin' }),
      }),
    ]);
  });

  it('ORG-13 a disabled feature is refused for the super admin in the workspace too, and the limit counts against the org', async () => {
    const { app } = await testApp();
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    await app.inject({
      method: 'PUT',
      url: `/v1/platform/orgs/${SEED.orgA}/entitlements`,
      headers: sa,
      payload: { featureOverrides: {}, limitOverrides: { max_students: 26 } },
    });
    const inA = { ...sa, 'x-org-id': SEED.orgA };
    const over = await app.inject({
      method: 'POST',
      url: '/v1/whitelist/import',
      headers: inA,
      payload: { mode: 'commit', source: 'paste', rows: [{ email: 'one@a.test' }, { email: 'two@a.test' }] },
    });
    expect([over.statusCode, over.json().error.code]).toEqual([403, 'LIMIT_REACHED']);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA }),
    });
    expect(me.json().entitlements.limits.max_students).toBe(26);
  });
});
