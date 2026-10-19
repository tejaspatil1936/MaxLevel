import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { ADMIN_ROUTE_SAMPLES, fillPath } from './test-support/admin-routes';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// IDs Firestore cannot hold as one document ID (a `/` sent as %2F makes a longer path; `.`, `..` and `__…__` are
// refused). Every route that takes an ID in its path or its request must answer them with 400 VALIDATION or 404,
// never 500 (API-01).

const { db, auth } = initFirebase();
const HOSTILE = ['a/b', '..', '.', '__x__'];

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
  for (const orgId of [SEED.orgA, SEED.orgB])
    await db.doc(`organizations/${orgId}`).update({ 'featureOverrides.analytics_reports': true });
});

const tokens = async () => {
  const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
  const student = await asClaims(auth, 'student01@a.test', {
    role: 'student',
    orgId: SEED.orgA,
    studentId: 'stu-org-a-01',
  });
  const superAdmin = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
  const device = await asClaims(auth, 'phone@device.test', { role: 'device', orgId: SEED.orgA, attemptId: 'att-1' });
  return { admin, student, superAdmin, device };
};

const accessOf = (r: { config: unknown }) => (r.config as { access?: string } | undefined)?.access;

describe('document IDs in requests', () => {
  it('API-01 every /v1 route answers a path ID Firestore cannot hold with 400 or 404, never 500', async () => {
    const { app } = await testApp();
    const t = await tokens();
    const headersFor: Record<string, Record<string, string>> = {
      admin: t.admin,
      adminOrStudent: t.admin,
      signedIn: t.admin,
      student: t.student,
      superAdmin: t.superAdmin,
      device: t.device,
    };
    const routes = app.routeTable.filter((r) => r.url.startsWith('/v1/') && r.url.includes(':'));
    expect(routes.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const r of routes) {
      const sample = ADMIN_ROUTE_SAMPLES[`${r.method} ${r.url}`];
      const names = [...r.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      for (const bad of HOSTILE) {
        const res = await app.inject({
          method: r.method as 'GET',
          url: fillPath(r.url, Object.fromEntries(names.map((n) => [n, bad]))),
          query: sample?.query,
          payload: sample?.body as object | undefined,
          headers: { ...headersFor[accessOf(r) ?? ''], 'idempotency-key': crypto.randomUUID() },
        });
        if (res.statusCode >= 500) failures.push(`${r.method} ${r.url} ${JSON.stringify(bad)}: ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it('API-01 request bodies and queries with an ID Firestore cannot hold are refused as VALIDATION', async () => {
    const { app } = await testApp();
    const t = await tokens();
    interface Req {
      method: 'GET' | 'POST' | 'PATCH';
      url: string;
      query?: Record<string, string>;
      payload?: object;
      headers?: Record<string, string>;
    }
    const requests = (bad: string): Req[] => [
      { method: 'POST', url: '/v1/reports', payload: { scope: 'test', refId: bad } },
      { method: 'POST', url: '/v1/reports', payload: { scope: 'series', refId: bad } },
      { method: 'POST', url: '/v1/exports', payload: { scope: 'test', refId: bad, format: 'csv' } },
      { method: 'GET', url: '/v1/tests', query: { seriesId: bad } },
      { method: 'POST', url: '/v1/tests', payload: { seriesId: bad, title: 'T', scheduledDate: '2026-11-03' } },
      { method: 'POST', url: '/v1/departments/dept-org-a-computer/merge', payload: { intoId: bad } },
      {
        method: 'POST',
        url: '/v1/students',
        payload: { email: 'm1@a.test', name: 'M One', prn: 'MAN-1', departmentId: bad, graduationYear: 2027 },
      },
      { method: 'PATCH', url: '/v1/students/stu-org-a-02', payload: { departmentId: bad } },
      { method: 'GET', url: '/v1/platform/audit', query: { orgId: bad }, headers: t.superAdmin },
      { method: 'POST', url: '/v1/attempts', payload: { testId: bad }, headers: t.student },
    ];
    const answers: string[] = [];
    const expected: string[] = [];
    for (const bad of HOSTILE)
      for (const q of requests(bad)) {
        const res = await app.inject({
          method: q.method,
          url: q.url,
          query: q.query,
          payload: q.payload,
          headers: { ...(q.headers ?? t.admin), 'idempotency-key': crypto.randomUUID() },
        });
        const code = (res.json() as { error?: { code?: string } }).error?.code;
        const where = `${q.method} ${q.url} ${JSON.stringify(bad)}`;
        answers.push(`${where}: ${res.statusCode} ${code}`);
        expected.push(`${where}: 400 VALIDATION`);
      }
    expect(answers).toEqual(expected);
    expect((await db.collection(`organizations/${SEED.orgA}/reports`).get()).size, 'nothing stored').toBe(0);
  });
});
