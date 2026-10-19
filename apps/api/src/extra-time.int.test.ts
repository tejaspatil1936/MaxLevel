import { autoSubmitAction, extensionNotice, liveRecordPath, signalPath, type AuditEntry } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, MIN, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/attempts/{id}/extra-time (OPS-06, OPS-08, OPS-09, EX-16, spec 11.3): the deadline moves with its audit
// entry, the auto-submit task follows the new deadline, and the live record and the student's signal get it.

const { db, auth, rtdb } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let api: ReturnType<typeof attemptClient>;

beforeAll(async () => {
  ctx = await testApp();
  api = attemptClient(ctx.app);
});

beforeEach(async () => {
  await clearEmulators();
  ctx.clock.set(NOW);
  await seedBase(db, NOW);
});

const adminA = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const superA = async () => ({
  ...(await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' })),
  'x-org-id': SEED.orgA,
});
const grant = async (id: string, headers: Record<string, string>, payload: object) => {
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/attempts/${id}/extra-time`, headers, payload });
  return { status: res.statusCode, body: res.json() as { deadlineAt: number; extraTimeSec: number }, raw: res.body };
};
const stored = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).data()!;
/** What the worker's auto-submit run decides from (shared `autoSubmitAction`). */
const timing = async (id: string) => {
  const a = await stored(id);
  return { status: a.status as string, deadlineAt: a.deadlineAt as number };
};
const extraOf = (e: AuditEntry) => (e.after as { extraTimeSec: number }).extraTimeSec;
const grants = async (id: string) =>
  (await db.collection(`${org}/auditLogs`).where('action', '==', 'attempt.extra_time.grant').get()).docs
    .map((d) => d.data() as AuditEntry)
    .filter((e) => e.target.id === id)
    // The test clock is frozen, so grants are ordered by the extra time they reached.
    .sort((a, b) => extraOf(a) - extraOf(b));
const autoSubmits = async (id: string) =>
  (await ctx.queue.pending()).filter((k) => k.path === '/tasks/auto-submit' && k.name.includes(id));

async function started(exam: object = {}) {
  const t = await api.examTest(exam);
  const s1 = await studentOf(auth, 1);
  const { body } = await api.start(t.testId, s1);
  return { t, s1, id: body.attempt.id, deadlineAt: body.attempt.deadlineAt, q: t.questionIds };
}

describe('extra time', () => {
  it('OPS-06 OPS-09 a grant moves the deadline with its audit entry, signals the student and queues the new auto-submit', async () => {
    const { t, id, deadlineAt } = await started();
    const res = await grant(id, await adminA(), { minutes: 10, reason: '  Power cut in lab 2 ' });
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toEqual({ deadlineAt: deadlineAt + 10 * MIN, extraTimeSec: 600 });
    expect(await stored(id)).toMatchObject({ status: 'in_progress', deadlineAt: deadlineAt + 10 * MIN });

    const [entry] = await grants(id);
    expect(entry).toMatchObject({
      actor: { email: 'admin1@a.test', role: 'admin' },
      target: { type: 'attempt', id },
      before: { deadlineAt },
      after: { minutes: 10, reason: 'Power cut in lab 2', deadlineAt: deadlineAt + 10 * MIN },
    });
    expect((await rtdb.ref(signalPath(SEED.orgA, id)).get()).val()).toEqual({
      deadlineAt: deadlineAt + 10 * MIN,
      notice: extensionNotice(10),
    });
    expect((await rtdb.ref(liveRecordPath(SEED.orgA, t.testId, id)).get()).val()).toMatchObject({
      status: 'in_progress',
      deadlineAt: deadlineAt + 10 * MIN,
    });
    expect((await autoSubmits(id)).map((k) => [k.name, k.scheduleTime]).sort()).toEqual([
      [`auto-submit-${id}-${deadlineAt}`, deadlineAt + 2 * MIN],
      [`auto-submit-${id}-${deadlineAt + 10 * MIN}`, deadlineAt + 12 * MIN],
    ]);

    // Grants add up; a super admin working in the org may grant, named as the actor.
    const second = await grant(id, await superA(), { minutes: 1, reason: 'Second power cut' });
    expect(second.body).toEqual({ deadlineAt: deadlineAt + 11 * MIN, extraTimeSec: 660 });
    expect((await rtdb.ref(signalPath(SEED.orgA, id)).get()).val()).toMatchObject({ notice: extensionNotice(1) });
    expect((await grants(id)).map((e) => e.actor.role)).toEqual(['admin', 'superAdmin']);
  });

  it('OPS-06 OPS-08 EX-16 extra time past a hard close: answers before the new deadline save, the old task finalizes nothing', async () => {
    // A flexible window with a hard close 30 minutes after the start, so the deadline is the window end.
    const { id, s1, q, deadlineAt, t } = await started({
      timingMode: 'flexible',
      durationMin: 60,
      windowMin: 30,
      overrides: { windowEndPolicy: 'hard_close' },
    });
    expect(deadlineAt).toBe(t.window.end);
    expect((await grant(id, await adminA(), { minutes: 10, reason: 'Network outage' })).status).toBe(200);
    const newDeadline = t.window.end + 10 * MIN;

    // Past the window end and the old task's run time, before the new deadline.
    ctx.clock.set(t.window.end + 3 * MIN);
    expect(autoSubmitAction(await timing(id), deadlineAt, ctx.clock.now())).toBe('reschedule');
    const now = ctx.clock.now();
    const saved = await api.answers(id, s1, {
      answers: [{ questionId: q[0], optionId: 'a', seq: 1, clientTs: now }],
      backlog: 0,
      clockOffsetMs: 0,
    });
    expect(saved.status, saved.raw).toBe(200);
    expect(saved.body.saved).toEqual([q[0]]);
    expect(await autoSubmits(id)).toContainEqual({
      name: `auto-submit-${id}-${newDeadline}`,
      path: '/tasks/auto-submit',
      scheduleTime: newDeadline + 2 * MIN,
    });
    // The task for the new deadline finalizes once its grace has passed.
    expect(autoSubmitAction(await timing(id), newDeadline, newDeadline + 2 * MIN)).toBe('finalize');
  });

  it('OPS-08 OPS-09 refused grants store neither the deadline nor an audit entry', async () => {
    const { id, s1, deadlineAt } = await started(); // a 60-minute slot
    const admin = await adminA();
    const refusals: Array<[object, number, string | undefined]> = [
      [{ minutes: 61, reason: 'Lab flooded' }, 409, 'EXTRA_TIME_CONFIRMATION_REQUIRED'],
      [{ minutes: 10 }, 400, 'VALIDATION'],
      [{ minutes: 10, reason: '   ' }, 400, 'VALIDATION'],
      [{ minutes: 0, reason: 'Zero' }, 400, 'VALIDATION'],
      [{ minutes: 2.5, reason: 'Half' }, 400, 'VALIDATION'],
      [{ minutes: 1441, reason: 'Too long', confirmOverDuration: true }, 400, 'VALIDATION'],
    ];
    for (const [payload, status, code] of refusals) {
      const res = await grant(id, admin, payload);
      expect([res.status, errorCode(res)], JSON.stringify(payload)).toEqual([status, code]);
    }
    expect((await grant(id, s1, { minutes: 10, reason: 'Myself' })).status).toBe(403);
    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await grant(id, adminB, { minutes: 10, reason: 'B' })).status).toBe(404);

    // The plan without extra-time grants refuses them (FF-02).
    const sa = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const off = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/platform/orgs/${SEED.orgA}/entitlements`,
      headers: sa,
      payload: { featureOverrides: { extra_time_grants: false }, limitOverrides: {} },
    });
    expect(off.statusCode, off.body).toBe(200);
    const disabled = await grant(id, admin, { minutes: 5, reason: 'Outage' });
    expect([disabled.status, errorCode(disabled)]).toEqual([403, 'FEATURE_DISABLED']);
    expect(await stored(id)).toMatchObject({ deadlineAt, extraTimeSec: 0 });
    expect(await grants(id)).toEqual([]);

    // Exactly the duration needs no confirmation; above it, the confirmation lets the grant through.
    await ctx.app.inject({
      method: 'PUT',
      url: `/v1/platform/orgs/${SEED.orgA}/entitlements`,
      headers: sa,
      payload: { featureOverrides: {}, limitOverrides: {} },
    });
    expect((await grant(id, admin, { minutes: 60, reason: 'Long outage' })).status).toBe(200);
    expect((await grant(id, admin, { minutes: 61, reason: 'Lab flooded', confirmOverDuration: true })).status).toBe(
      200,
    );
    expect(await stored(id)).toMatchObject({ deadlineAt: deadlineAt + 121 * MIN, extraTimeSec: 121 * 60 });

    // A finished attempt takes no more time.
    const done = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${id}/submit`,
      headers: { ...s1, 'idempotency-key': crypto.randomUUID() },
      payload: {},
    });
    expect(done.statusCode).toBe(200);
    const late = await grant(id, admin, { minutes: 5, reason: 'Late' });
    expect([late.status, errorCode(late)]).toEqual([409, 'ATTEMPT_FINISHED']);
    expect(await grants(id)).toHaveLength(2);
  });
});
