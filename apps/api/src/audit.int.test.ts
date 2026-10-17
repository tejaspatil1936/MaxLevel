import { TestClock } from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createData } from './data';
import { initFirebase } from './firebase';
import { auditWriter } from './services/audit';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const auditDocs = async (orgId: string) =>
  (await db.collection(`organizations/${orgId}/auditLogs`).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

describe('audit entries', () => {
  it('AUD-01 an admin change records actor, org, action, target, before, after, time, IP, user agent and request ID', async () => {
    const { app, clock } = await testApp();
    clock.set(1_790_000_000_000);
    const headers = {
      ...(await asClaims(auth, 'admin2@a.test', { role: 'admin', orgId: SEED.orgA })),
      'user-agent': 'Vitest/1',
      'x-request-id': 'req-aud-1',
    };
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/org/settings',
      payload: { profileLocked: true },
      headers,
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(200);
    const [entry, ...rest] = await auditDocs(SEED.orgA);
    expect(rest).toEqual([]);
    expect(entry).toEqual({
      id: expect.any(String),
      orgId: SEED.orgA,
      actor: { uid: expect.any(String), role: 'admin', email: 'admin2@a.test' },
      action: 'org.settings.update',
      target: { type: 'organization', id: SEED.orgA },
      before: { profileLocked: false },
      after: { profileLocked: true },
      ip: '203.0.113.7',
      userAgent: 'Vitest/1',
      requestId: 'req-aud-1',
      createdAt: 1_790_000_000_000,
    });
  });

  it('AUD-01 sensitive fields are removed from before and after values', async () => {
    const data = createData(db);
    const write = auditWriter(data, new TestClock());
    const req = {
      user: { uid: 'u', role: 'admin', email: 'a@a.test' },
      orgId: SEED.orgA,
      ip: '1.1.1.1',
      headers: {},
      id: 'r1',
    } as unknown as FastifyRequest;
    const batch = db.batch();
    write(req, batch, {
      action: 'question.update',
      target: { type: 'question', id: 'q1' },
      before: { prompt: 'p', correctOptionIds: ['a'], explanation: 'x' },
    });
    await batch.commit();
    expect((await auditDocs(SEED.orgA))[0]!.before).toEqual({ prompt: 'p' });
  });
});

describe('audit atomicity', () => {
  it('AUD-02 the entry commits in the same batch as the change: a failed change leaves no entry', async () => {
    const data = createData(db);
    const write = auditWriter(data, new TestClock());
    const req = {
      user: { uid: 'u', role: 'admin', email: 'a@a.test' },
      orgId: SEED.orgA,
      ip: '1.1.1.1',
      headers: {},
      id: 'r2',
    } as unknown as FastifyRequest;
    const failing = db.batch();
    failing.update(db.doc(`organizations/${SEED.orgA}/students/does-not-exist`), { name: 'x' });
    write(req, failing, { action: 'student.update', target: { type: 'student', id: 'does-not-exist' } });
    await expect(failing.commit()).rejects.toThrow();
    expect(await auditDocs(SEED.orgA)).toEqual([]);

    const ok = db.batch();
    ok.update(db.doc(`organizations/${SEED.orgA}/students/stu-org-a-01`), { name: 'Aarav K.' });
    write(req, ok, { action: 'student.update', target: { type: 'student', id: 'stu-org-a-01' } });
    await ok.commit();
    expect((await auditDocs(SEED.orgA)).map((e) => e.action)).toEqual(['student.update']);
  });
});

describe('append-only log', () => {
  it('AUD-04 no route can edit or delete audit entries and the data layer only appends', async () => {
    const { app } = await testApp();
    const writes = app.routeTable.filter((r) => /audit/i.test(r.url) && ['PUT', 'PATCH', 'DELETE'].includes(r.method));
    expect(writes).toEqual([]);
    expect(Object.keys(createData(db).audit).sort()).toEqual(['addAudit', 'listAudit']);
  });
});
