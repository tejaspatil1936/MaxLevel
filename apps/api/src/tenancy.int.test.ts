import type { DocumentReference } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { ADMIN_ROUTE_SAMPLES, fillPath } from './test-support/admin-routes';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

const tokens = async () => ({
  adminA: await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA }),
  superAdmin: await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' }),
  student: await asClaims(auth, 'student01@a.test', { role: 'student', orgId: SEED.orgA, studentId: 'stu-org-a-01' }),
});

const accessOf = (r: { config: unknown }) => (r.config as { access?: string } | undefined)?.access;

/** Routes an admin may call: admin-only ones, and those serving admins and students alike (leaderboards). */
async function adminRoutes() {
  const { app } = await testApp();
  const routes = app.routeTable.filter((r) => accessOf(r) === 'admin' || accessOf(r) === 'adminOrStudent');
  return { app, routes };
}

describe('admin route table', () => {
  it('ORG-14 every admin route answers the same for an admin token and a super-admin token with X-Org-Id', async () => {
    const { app, routes } = await adminRoutes();
    expect(routes.length).toBeGreaterThan(0);
    const t = await tokens();
    const results: string[] = [];
    let n = 0;
    for (const r of routes) {
      const key = `${r.method} ${r.url}`;
      const sample = ADMIN_ROUTE_SAMPLES[key];
      expect(sample, `add a sample for ${key} in test-support/admin-routes.ts`).toBeDefined();
      const call = async (headers: Record<string, string>) => {
        const fresh = sample!.fresh ? await sample!.fresh(db, n++) : {};
        return app.inject({
          method: r.method as 'GET',
          url: fillPath(r.url, fresh.params ?? sample!.params),
          query: sample!.query,
          payload: (fresh.body ?? sample!.body) as object | undefined,
          headers,
        });
      };
      const asAdmin = await call(t.adminA);
      const asSuper = await call({ ...t.superAdmin, 'x-org-id': SEED.orgA });
      results.push(`${key}: admin ${asAdmin.statusCode}, super admin ${asSuper.statusCode}`);
      expect([401, 403], `${key} refused the admin`).not.toContain(asAdmin.statusCode);
      expect(asSuper.statusCode, `${key} differs for the super admin`).toBe(asAdmin.statusCode);
    }
    expect(results.length).toBe(routes.length);
  });

  it('ORG-11 admin route guards allow the admin of the org or a super admin, never other roles', async () => {
    const { app, routes } = await adminRoutes();
    const t = await tokens();
    const device = await asClaims(auth, 'phone@device.test', { role: 'device', orgId: SEED.orgA, attemptId: 'att-1' });
    for (const r of routes) {
      const base = ADMIN_ROUTE_SAMPLES[`${r.method} ${r.url}`] ?? {};
      const sample = { ...base, ...(base.fresh ? await base.fresh(db, 900 + routes.indexOf(r)) : {}) };
      const refused = accessOf(r) === 'admin' ? [t.student, device, { ...t.student, 'x-org-id': SEED.orgA }] : [device];
      for (const headers of refused) {
        const res = await app.inject({
          method: r.method as 'GET',
          url: fillPath(r.url, sample.params),
          payload: sample.body as object,
          headers,
        });
        expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
      }
      const anon = await app.inject({
        method: r.method as 'GET',
        url: fillPath(r.url, sample.params),
        payload: sample.body as object,
      });
      expect(anon.statusCode).toBe(401);
    }
  });

  it('ORG-05 an admin of org A gets 404 for every org B resource, and X-Org-Id cannot move them', async () => {
    const { app, routes } = await adminRoutes();
    const t = await tokens();
    for (const r of routes.filter((x) => x.url.includes(':'))) {
      const sample = ADMIN_ROUTE_SAMPLES[`${r.method} ${r.url}`];
      const fresh = sample?.fresh ? await sample.fresh(db, 800 + routes.indexOf(r)) : {};
      expect(sample?.foreignParams, `add foreignParams (an org B resource) for ${r.method} ${r.url}`).toBeDefined();
      const res = await app.inject({
        method: r.method as 'GET',
        url: fillPath(r.url, sample!.foreignParams),
        payload: (fresh.body ?? sample!.body) as object,
        headers: t.adminA,
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404);
    }
    const org = await app.inject({ method: 'GET', url: '/v1/org', headers: { ...t.adminA, 'x-org-id': SEED.orgB } });
    expect(org.json()).toMatchObject({ id: SEED.orgA, name: 'MIT Academy of Engineering' });
    const sa = { ...t.superAdmin };
    for (const bad of ['org-a/departments/dept-org-a-computer', '..', 'ORG-A', '']) {
      const res = await app.inject({ method: 'GET', url: '/v1/org', headers: { ...sa, 'x-org-id': bad } });
      expect([res.statusCode, bad]).toEqual([bad ? 404 : 400, bad]);
    }
    const write = await app.inject({
      method: 'PATCH',
      url: '/v1/org/settings',
      payload: { profileLocked: true },
      headers: { ...t.adminA, 'x-org-id': SEED.orgB },
    });
    expect(write.statusCode).toBe(200);
    expect((await db.doc(`organizations/${SEED.orgB}`).get()).get('profileLocked')).toBe(false);
  });
});

describe('organization scope', () => {
  it('ORG-04 a super admin acting in org A writes the audit entry into org A with themselves as actor', async () => {
    const { app } = await testApp();
    const t = await tokens();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/org/settings',
      payload: { profileLocked: true },
      headers: { ...t.superAdmin, 'x-org-id': SEED.orgA },
    });
    expect(res.json()).toMatchObject({ id: SEED.orgA, profileLocked: true });
    const logA = await db.collection(`organizations/${SEED.orgA}/auditLogs`).get();
    expect(logA.docs.map((d) => d.data())).toEqual([
      expect.objectContaining({
        orgId: SEED.orgA,
        action: 'org.settings.update',
        actor: expect.objectContaining({ role: 'superAdmin', email: SEED.superAdmin }),
      }),
    ]);
    expect((await db.collection(`organizations/${SEED.orgB}/auditLogs`).get()).size).toBe(0);
  });

  it('ORG-01 every record under organizations/{orgId} carries that orgId', async () => {
    const { app } = await testApp();
    const t = await tokens();
    await app.inject({ method: 'PATCH', url: '/v1/org/settings', payload: { profileLocked: true }, headers: t.adminA });
    const problems: string[] = [];
    const visit = async (ref: DocumentReference, orgId: string) => {
      const snap = await ref.get();
      if (snap.exists && snap.get('orgId') !== orgId) problems.push(ref.path);
      const cols = await ref.listCollections();
      const docs = (await Promise.all(cols.map((c) => c.listDocuments()))).flat();
      await Promise.all(docs.map((d) => visit(d, orgId)));
    };
    const orgs = await db.collection('organizations').listDocuments();
    expect(orgs.length).toBe(2);
    await Promise.all(orgs.map((o) => visit(o, o.id)));
    expect(problems).toEqual([]);
  });
});
