import { TestClock } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer } from './app';
import { loadConfig } from './config';
import { createData } from './data';
import type { AppError } from './errors';
import { initFirebase } from './firebase';
import { registerAuth } from './plugins/auth';
import { entitlementsService } from './services/entitlements';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const data = createData(db);

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

async function gatedServer() {
  const clock = new TestClock();
  const entitlements = entitlementsService(data, clock);
  const app = await createServer({ ...loadConfig({}), logLevel: 'silent' }, clock);
  registerAuth(app, { auth, data, entitlements });
  const ok = { schema: { response: { 200: z.object({ ok: z.boolean() }) } } };
  app.post('/v1/reports', { ...ok, config: { access: 'admin', feature: 'analytics_reports' } }, async () => ({
    ok: true,
  }));
  app.post('/v1/exports', { ...ok, config: { access: 'admin', feature: 'results_export' } }, async () => ({
    ok: true,
  }));
  return { app, clock, entitlements };
}

describe('feature gate', () => {
  it('FF-02 a route behind a disabled feature returns 403 FEATURE_DISABLED for the admin and the super admin', async () => {
    const { app } = await gatedServer();
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    const sa = { ...(await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' })), 'x-org-id': SEED.orgA };
    for (const headers of [admin, sa]) {
      const res = await app.inject({ method: 'POST', url: '/v1/reports', headers });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'FEATURE_DISABLED', details: { feature: 'analytics_reports' } });
      expect((await app.inject({ method: 'POST', url: '/v1/exports', headers })).statusCode).toBe(200);
    }
  });

  it('FF-02 an org override turns the feature on, and a plan can turn one off', async () => {
    const { app, clock, entitlements } = await gatedServer();
    const admin = await asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
    await db.doc(`organizations/${SEED.orgA}`).update({ 'featureOverrides.analytics_reports': true });
    await db.doc('plans/standard').update({ 'features.results_export': false });
    entitlements.invalidate(SEED.orgA);
    expect((await app.inject({ method: 'POST', url: '/v1/reports', headers: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/exports', headers: admin })).statusCode).toBe(403);
    // A change made elsewhere reaches this instance once its 60-second cache expires.
    await db.doc(`organizations/${SEED.orgA}`).update({ 'featureOverrides.analytics_reports': false });
    expect((await app.inject({ method: 'POST', url: '/v1/reports', headers: admin })).statusCode).toBe(200);
    clock.advance(60_000);
    expect((await app.inject({ method: 'POST', url: '/v1/reports', headers: admin })).statusCode).toBe(403);
  });

  it('FF-02 GET /v1/me reports the effective flags and limits so the UI can lock features', async () => {
    const { app } = await testApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB }),
    });
    expect(res.json().entitlements).toMatchObject({
      features: { analytics_reports: false, results_export: true },
      limits: { max_students: 2000 },
    });
  });
});

describe('usage counters', () => {
  it('FF-04 concurrent jobs take a monthly allowance atomically and stop exactly at the limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => data.usage.takeUsage(SEED.orgA, '2026-10', 'aiImports', 5)),
    );
    expect(results.filter(Boolean).length).toBe(5);
    expect((await data.usage.getUsage(SEED.orgA, '2026-10')).aiImports).toBe(5);
    expect((await data.usage.getUsage(SEED.orgB, '2026-10')).aiImports).toBe(0);
  });

  it('FF-04 a job past the limit is refused before it starts, and a new month starts from zero', async () => {
    const clock = new TestClock();
    clock.set(Date.UTC(2026, 9, 31, 12, 0));
    const svc = entitlementsService(data, clock);
    await db.doc(`organizations/${SEED.orgA}`).update({ 'limitOverrides.ai_reports_per_month': 2 });
    await svc.takeMonthly(SEED.orgA, 'aiReports', 'ai_reports_per_month');
    await svc.takeMonthly(SEED.orgA, 'aiReports', 'ai_reports_per_month');
    const refused = await svc.takeMonthly(SEED.orgA, 'aiReports', 'ai_reports_per_month').catch((e: AppError) => e);
    expect(refused).toMatchObject({ statusCode: 403, code: 'LIMIT_REACHED' });
    expect((await data.usage.getUsage(SEED.orgA, '2026-10')).aiReports).toBe(2);
    clock.set(Date.UTC(2026, 10, 1, 0, 0)); // 05:30 on 1 November in Asia/Kolkata
    await svc.takeMonthly(SEED.orgA, 'aiReports', 'ai_reports_per_month');
    expect((await data.usage.getUsage(SEED.orgA, '2026-11')).aiReports).toBe(1);
  });
});
