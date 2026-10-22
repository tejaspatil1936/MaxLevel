import type { AttemptEvent } from '@mitaoe/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { attemptClient, errorCode, leaks, NOW, studentOf } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// Proctoring events and strikes (PR-07, PR-08, PR-10, PR-11, DATA-05): POST and GET /v1/attempts/{id}/events on the
// emulators. Each test uses its own students, so the per-user event limit (API-06) never interferes.

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

type EventBody = { strikesCount: number; counted: boolean; status: string };
const report = async (id: string, headers: Record<string, string>, type: string, details: object = {}) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/attempts/${id}/events`,
    headers,
    payload: { type, clientTs: ctx.clock.now() - 50, details },
  });
  return { status: res.statusCode, body: res.json() as EventBody, raw: res.body };
};
const timeline = async (id: string, headers: Record<string, string>) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/v1/attempts/${id}/events`, headers });
  return { status: res.statusCode, body: res.json() as { items: AttemptEvent[] }, raw: res.body };
};
const stored = async (id: string) => (await db.doc(`${org}/attempts/${id}`).get()).data()!;
const adminA = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });

async function started(n: number, overrides: object = {}) {
  const t = await api.examTest({ overrides });
  const headers = await studentOf(auth, n);
  const res = await api.start(t.testId, headers);
  expect(res.status, res.raw).toBe(201);
  return { t, headers, id: res.body.attempt.id };
}

describe('proctoring events', () => {
  it('PR-07 PR-11 strike events within 3 seconds of the last counted one are logged without a strike number', async () => {
    const { headers, id } = await started(1, { maxStrikes: 5 });
    expect((await report(id, headers, 'fullscreen_exit', { source: 'test' })).body).toEqual({
      strikesCount: 1,
      counted: true,
      status: 'in_progress',
    });
    ctx.clock.set(NOW + 2_999);
    expect((await report(id, headers, 'window_blur')).body).toMatchObject({ strikesCount: 1, counted: false });
    expect((await report(id, headers, 'context_menu')).body).toMatchObject({ strikesCount: 1, counted: false });
    ctx.clock.set(NOW + 3_000);
    expect((await report(id, headers, 'tab_hidden')).body).toMatchObject({ strikesCount: 2, counted: true });
    // Logged-only types never count, even long after the last strike.
    ctx.clock.set(NOW + 60_000);
    expect((await report(id, headers, 'devtools')).body).toMatchObject({ strikesCount: 3, counted: true });
    ctx.clock.set(NOW + 120_000);
    expect((await report(id, headers, 'clipboard', { action: 'paste' })).body).toMatchObject({ counted: false });

    expect(await stored(id)).toMatchObject({ strikesCount: 3, lastStrikeAt: NOW + 60_000, status: 'in_progress' });
    const listed = await timeline(id, await adminA());
    expect(listed.status, listed.raw).toBe(200);
    expect(listed.body.items.map((e) => [e.type, e.serverTs, e.strikeNumber ?? null])).toEqual([
      ['fullscreen_exit', NOW, 1],
      ['window_blur', NOW + 2_999, null],
      ['context_menu', NOW + 2_999, null],
      ['tab_hidden', NOW + 3_000, 2],
      ['devtools', NOW + 60_000, 3],
      ['clipboard', NOW + 120_000, null],
    ]);
  });

  it('PR-11 every event, counted or not, is stored with server time, client time, type and details, in order', async () => {
    const { headers, id } = await started(2, { devtoolsPolicy: 'block' });
    for (const [type, details] of [
      ['tab_hidden', { hidden: true }],
      ['devtools', { key: 'F12' }],
      ['print', {}],
      ['context_menu', { x: 1 }],
    ] as const)
      expect((await report(id, headers, type, details)).status).toBe(200);
    const events = (await db.collection(`${org}/attempts/${id}/events`).get()).docs.map((d) => d.data());
    expect(events).toHaveLength(4);
    for (const e of events)
      expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(['clientTs', 'details', 'serverTs', 'type']));
    const listed = (await timeline(id, await adminA())).body.items;
    expect(listed.map((e) => [e.type, e.details, e.clientTs, e.serverTs, e.strikeNumber ?? null])).toEqual([
      ['tab_hidden', { hidden: true }, NOW - 50, NOW, 1],
      ['devtools', { key: 'F12' }, NOW - 50, NOW, null],
      ['print', {}, NOW - 50, NOW, null],
      ['context_menu', { x: 1 }, NOW - 50, NOW, null],
    ]);
    expect((await stored(id)).strikesCount, 'devtools under block is logged only').toBe(1);
  });

  it('PR-08 concurrent reports count in a transaction from the stored count; the client’s count is never read', async () => {
    const { headers, id } = await started(3, { maxStrikes: 10 });
    const same = await Promise.all(Array.from({ length: 5 }, () => report(id, headers, 'window_blur')));
    expect(same.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(
      same.filter((r) => r.body.counted),
      'one incident, one strike',
    ).toHaveLength(1);
    expect(same.map((r) => r.body.strikesCount)).toEqual([1, 1, 1, 1, 1]);
    expect((await stored(id)).strikesCount).toBe(1);
    expect((await db.collection(`${org}/attempts/${id}/events`).get()).size).toBe(5);

    ctx.clock.set(NOW + 5_000);
    const claimed = await report(id, headers, 'tab_hidden', { strikesCount: 7 });
    expect(claimed.body).toMatchObject({ strikesCount: 2, counted: true });
    const extra = await ctx.app.inject({
      method: 'POST',
      url: `/v1/attempts/${id}/events`,
      headers,
      payload: { type: 'tab_hidden', clientTs: NOW, details: {}, strikesCount: 0 },
    });
    expect(extra.statusCode, 'a client count is refused').toBe(400);
    expect((await stored(id)).strikesCount).toBe(2);
    const live = (await ctx.firebase.rtdb.ref(`live/${SEED.orgA}`).get()).val() as Record<string, object>;
    expect(Object.values(live)[0]).toMatchObject({ [id]: { strikes: 2 } });
  });

  it('PR-10 the strike that reaches the maximum terminates and grades once; later answers and events are refused', async () => {
    const { t, headers, id } = await started(4, { maxStrikes: 2 });
    const save = (q: string, optionId: string, seq: number) =>
      api.answers(id, headers, {
        answers: [{ questionId: q, optionId, seq, clientTs: ctx.clock.now() }],
        backlog: 0,
        clockOffsetMs: 0,
      });
    expect((await save(t.questionIds[0]!, 'a', 1)).status).toBe(200);
    expect((await report(id, headers, 'tab_hidden')).body).toMatchObject({ strikesCount: 1, status: 'in_progress' });
    ctx.clock.set(NOW + 4_000);
    const last = await Promise.all([report(id, headers, 'no_face'), report(id, headers, 'multiple_faces')]);
    const ended = last.find((r) => r.status === 200 && r.body.counted)!;
    expect(ended.body).toEqual({ strikesCount: 2, counted: true, status: 'terminated' });
    for (const r of last) expect([200, 409], r.raw).toContain(r.status);

    const a = await stored(id);
    expect(a).toMatchObject({
      status: 'terminated',
      terminationReason: 'max_strikes',
      strikesCount: 2,
      submittedAt: NOW + 4_000,
      result: { score: 1, max: 4, correct: 1, incorrect: 0, unanswered: 3 },
    });
    const graded = (await ctx.queue.pending()).filter((task) => task.path === '/tasks/leaderboard');
    expect(graded, 'graded once').toHaveLength(1);

    ctx.clock.set(NOW + 10_000);
    const answer = await save(t.questionIds[1]!, 'b', 1);
    expect([answer.status, errorCode(answer)]).toEqual([409, 'ATTEMPT_FINISHED']);
    const later = await report(id, headers, 'tab_hidden');
    expect([later.status, errorCode(later)]).toEqual([409, 'ATTEMPT_FINISHED']);
    expect(await stored(id)).toMatchObject({ strikesCount: 2, result: a.result, submittedAt: NOW + 4_000 });
  });

  it('PR-11 ORG-05 ORG-14 the timeline is open to admins of the attempt org and super admins, and to nobody else', async () => {
    const { headers, id } = await started(5);
    await report(id, headers, 'window_blur');
    const own = await timeline(id, await adminA());
    expect(own.body.items.map((e) => e.type)).toEqual(['window_blur']);

    const adminB = await asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
    expect((await timeline(id, adminB)).status).toBe(404);
    const superAdmin = await asClaims(auth, SEED.superAdmin, { role: 'superAdmin' });
    const asSuper = await timeline(id, { ...superAdmin, 'x-org-id': SEED.orgA });
    expect([asSuper.status, asSuper.body]).toEqual([200, own.body]);
    expect((await timeline(id, { ...superAdmin, 'x-org-id': SEED.orgB })).status).toBe(404);
    expect((await timeline(id, headers)).status, 'a student').toBe(403);
    expect((await timeline('missing', await adminA())).status).toBe(404);

    expect((await report(id, await studentOf(auth, 6), 'tab_hidden')).status, 'another student').toBe(404);
    expect((await report(id, await studentOf(auth, 1, SEED.orgB), 'tab_hidden')).status, 'another org').toBe(404);
    expect((await report(id, await adminA(), 'tab_hidden')).status, 'an admin').toBe(403);
    expect((await timeline(id, await adminA())).body.items).toHaveLength(1);
  });

  it('DATA-05 event responses and the attempt read after termination carry no answer key or explanation', async () => {
    const { headers, id } = await started(7, { maxStrikes: 1 });
    const ended = await report(id, headers, 'fullscreen_exit');
    expect(ended.body.status).toBe('terminated');
    const resumed = await api.resume(id, headers);
    expect([resumed.status, resumed.body.attempt.status]).toEqual([200, 'terminated']);
    expect(resumed.body.attempt.strikesCount).toBe(1);
    for (const raw of [ended.raw, resumed.raw]) expect(leaks(raw)).toEqual([]);
  });
});

describe('phone outages', () => {
  const task = (id: string, outage: string) => db.doc(`_localTasks/phone-check-${id}-${outage}`).get();

  it('PR-16 REL-04 a phone paused report queues one check, due when the outage reaches 60 seconds', async () => {
    const { headers, id } = await started(11, { secondCamera: true });
    const paused = { offlineMs: 16_000, stateSince: 111, lastSeen: 222 };
    expect((await report(id, headers, 'phone_paused', paused)).body).toEqual({
      strikesCount: 0,
      counted: false,
      status: 'in_progress',
    });
    const queued = await task(id, '111-222');
    expect(queued.data()).toMatchObject({
      path: '/tasks/phone-check',
      payload: { orgId: SEED.orgA, attemptId: id, stateSince: 111, lastSeen: 222 },
      // The report's clientTs is 50 ms before the server's clock.
      scheduleTime: NOW - 50 + 44_000,
    });
    ctx.clock.set(NOW + 5_000);
    expect((await report(id, headers, 'phone_paused', paused)).status, 'a repeat').toBe(200);
    expect((await task(id, '111-222')).get('scheduleTime'), 'the first check is kept').toBe(NOW - 50 + 44_000);
    expect((await report(id, headers, 'phone_paused', { offlineMs: 'x' })).status).toBe(200);
    expect((await task(id, 'none-none')).exists, 'an unreadable outage is still checked').toBe(true);
  });

  it('PR-16 without a second camera a phone paused report is only logged', async () => {
    const { headers, id } = await started(12);
    expect((await report(id, headers, 'phone_paused', { offlineMs: 16_000, stateSince: 1, lastSeen: 2 })).status).toBe(
      200,
    );
    expect((await task(id, '1-2')).exists).toBe(false);
  });

  it('PR-10 PR-15 an attempt ended by a strike tells its phone through the proctor record', async () => {
    const { headers, id } = await started(13, { maxStrikes: 1 });
    expect((await report(id, headers, 'tab_hidden')).body).toMatchObject({ status: 'terminated' });
    await expect.poll(async () => (await rtdb.ref(`proctor/${SEED.orgA}/${id}/status`).get()).val()).toBe('terminated');
  });
});
