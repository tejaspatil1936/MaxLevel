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

describe('org storage management', () => {
  it('allows super-admins to list storage and clear junk without touching logos', async () => {
    const { app, firebase } = await testApp();
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const org = SEED.orgA;

    // Seed test files in storage bucket
    await firebase.bucket.file(`organizations/${org}/imports/job1/source.pdf`).save(Buffer.from('PDF_CONTENT'));
    await firebase.bucket.file(`organizations/${org}/exports/exp1/results.csv`).save(Buffer.from('CSV_CONTENT'));
    await firebase.bucket.file(`organizations/${org}/logo.png`).save(Buffer.from('PNG_LOGO'));

    // Check storage summary
    const viewRes = await app.inject({
      method: 'GET',
      url: `/v1/platform/orgs/${org}/storage`,
      headers: sa,
    });
    expect(viewRes.statusCode).toBe(200);
    const summary = viewRes.json();
    expect(summary.totalFiles).toBeGreaterThanOrEqual(3);
    expect(summary.categories.imports.count).toBe(1);
    expect(summary.categories.exports.count).toBe(1);
    expect(summary.categories.logos.count).toBe(1);

    // Clear 'all' storage (should protect logo)
    const clearRes = await app.inject({
      method: 'POST',
      url: `/v1/platform/orgs/${org}/storage/clear`,
      headers: sa,
      payload: { category: 'all' },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().deletedCount).toBeGreaterThanOrEqual(2);

    // Verify logo is still present, but import is deleted
    const [logoExists] = await firebase.bucket.file(`organizations/${org}/logo.png`).exists();
    const [importExists] = await firebase.bucket.file(`organizations/${org}/imports/job1/source.pdf`).exists();
    expect(logoExists).toBe(true);
    expect(importExists).toBe(false);

    // Verify regular admin cannot access storage endpoints
    const adminHeaders = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: org });
    const forbidden = await app.inject({
      method: 'GET',
      url: `/v1/platform/orgs/${org}/storage`,
      headers: adminHeaders,
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
