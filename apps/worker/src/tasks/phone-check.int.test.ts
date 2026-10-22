import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorker } from '../app';
import { loadConfig } from '../config';
import { workerData } from '../data';
import { initFirestore } from '../firebase';
import { initRtdb, liveMirror, presenceReader } from '../live';
import { clearFirestore } from '../test-support/emulators';
import { localTaskQueue } from './local-queue';

// /tasks/phone-check on the emulators (PR-16, PR-10, REL-04, REL-05): the worker decides a phone outage strike from
// the presence records, never the laptop's word.

const db = initFirestore();
const rtdb = initRtdb();
const clock = new TestClock();
let app: FastifyInstance;
const org = db.doc('organizations/org-a');
const START = 1_793_592_000_000;
const NOW = START + 10 * 60_000;
const PHONE = 'presence/org-a/t1/att-1/phone';
const LAPTOP = 'presence/org-a/t1/att-1/laptop';
const outage = { stateSince: 1_000, lastSeen: 2_000 };
const offline = { online: false, lastSeen: 2_000, cameraOn: false, camera: 'live', session: 's1', stateSince: 1_000 };

beforeAll(async () => {
  app = await buildWorker({
    clock,
    config: { ...loadConfig({ NODE_ENV: 'test' }), logLevel: 'silent' },
    data: workerData(db),
    queue: localTaskQueue(db, clock),
    live: liveMirror(rtdb),
    presence: presenceReader(rtdb),
  });
});

async function seed(strikesCount = 0) {
  await org
    .collection('tests')
    .doc('t1')
    .set({
      seriesId: 's1',
      sections: [],
      resolved: { marking: { marks: 1, negativeMarks: 0, preset: 'custom' }, maxStrikes: 3, devtoolsPolicy: 'block' },
    });
  await org
    .collection('tests/t1/questions')
    .doc('q1')
    .set({ correctOptionIds: ['a'] });
  await org
    .collection('attempts')
    .doc('att-1')
    .set({
      orgId: 'org-a',
      testId: 't1',
      seriesId: 's1',
      studentId: 'stu-1',
      status: 'in_progress',
      startedAt: START,
      deadlineAt: START + 60 * 60_000,
      strikesCount,
      draw: { questionIds: ['q1'], optionOrder: {}, sections: [{ sectionId: null, questionIds: ['q1'] }] },
    });
}

beforeEach(async () => {
  await clearFirestore();
  await rtdb.ref().set(null);
  clock.set(NOW);
  await seed();
  await rtdb.ref(LAPTOP).set({ online: true, lastSeen: 1, fullscreen: true, visible: true });
});

const run = (payload: object = { orgId: 'org-a', attemptId: 'att-1', ...outage }) =>
  app.inject({ method: 'POST', url: '/tasks/phone-check', payload });
const attempt = async () => (await org.collection('attempts').doc('att-1').get()).data()!;
const events = async () => (await org.collection('attempts/att-1/events').get()).docs.map((d) => d.data());
const outcome = async (payload?: object) => {
  const res = await run(payload);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { outcome: string }).outcome;
};

describe('the phone check task', () => {
  it('PR-16 PR-09 REL-04 a phone still offline is one phone_disconnected strike, shown to the laptop, and a second run counts nothing', async () => {
    await rtdb.ref(PHONE).set(offline);
    expect(await outcome()).toBe('counted');
    expect(await attempt()).toMatchObject({ strikesCount: 1, lastStrikeAt: NOW, status: 'in_progress' });
    expect(await events()).toEqual([
      {
        orgId: 'org-a',
        type: 'phone_disconnected',
        details: { source: 'server', ...outage },
        clientTs: NOW,
        serverTs: NOW,
        strikeNumber: 1,
      },
    ]);
    await expect
      .poll(async () => (await rtdb.ref('proctor/org-a/att-1/strike').get()).val())
      .toEqual({ eventId: 'phone-1000-2000', type: 'phone_disconnected', strikesCount: 1, status: 'in_progress' });
    await expect.poll(async () => (await rtdb.ref('live/org-a/t1/att-1/strikes').get()).val()).toBe(1);

    clock.set(NOW + 60_000);
    expect(await outcome(), 'the same outage again').toBe('repeat');
    expect((await attempt()).strikesCount).toBe(1);
    expect(await events()).toHaveLength(1);
  });

  it('PR-16 a camera paused since the report, a missing record and a frozen record are the same outage', async () => {
    const fresh = async () => {
      await clearFirestore();
      await seed();
    };
    await rtdb.ref(PHONE).set({ ...offline, online: true, camera: 'paused', lastSeen: 9_000 });
    expect(await outcome(), 'camera paused').toBe('counted');
    await fresh();
    await rtdb.ref(PHONE).set(null);
    expect(await outcome(), 'no record').toBe('counted');
    await fresh();
    await rtdb.ref(PHONE).set({ ...offline, online: true, cameraOn: true });
    expect(await outcome(), 'healthy on paper, but no heartbeat since the report').toBe('counted');
  });

  it('PR-16 a phone that came back, or dropped again since, is not struck for this outage', async () => {
    await rtdb.ref(PHONE).set({ ...offline, online: true, cameraOn: true, lastSeen: 9_000, stateSince: 8_000 });
    expect(await outcome()).toBe('recovered');
    await rtdb.ref(PHONE).set({ ...offline, stateSince: 9_500, lastSeen: 9_500 });
    expect(await outcome()).toBe('recovered');
    expect((await attempt()).strikesCount).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('REL-05 no strike while the laptop is offline too, and none on an attempt that has ended', async () => {
    await rtdb.ref(PHONE).set(offline);
    await rtdb.ref(LAPTOP).update({ online: false });
    expect(await outcome()).toBe('laptop_offline');
    await rtdb.ref(LAPTOP).update({ online: true });
    await org.collection('attempts').doc('att-1').update({ status: 'submitted' });
    expect(await outcome()).toBe('finished');
    expect(await events()).toEqual([]);
    expect(await outcome({ orgId: 'org-a', attemptId: 'nobody', ...outage })).toBe('skipped');
  });

  it('PR-10 the strike that reaches the maximum terminates and grades the attempt, and tells the phone', async () => {
    await seed(2);
    await rtdb.ref(PHONE).set(offline);
    expect(await outcome()).toBe('terminated');
    expect(await attempt()).toMatchObject({
      status: 'terminated',
      terminationReason: 'max_strikes',
      strikesCount: 3,
      submittedAt: NOW,
      result: expect.objectContaining({ unanswered: 1 }),
    });
    await expect.poll(async () => (await rtdb.ref('proctor/org-a/att-1/status').get()).val()).toBe('terminated');
    await expect
      .poll(async () => (await rtdb.ref('proctor/org-a/att-1/strike').get()).val())
      .toMatchObject({ strikesCount: 3, status: 'terminated' });
    const queued = (await db.collection('_localTasks').get()).docs.map((d) => d.get('path') as string);
    expect(queued).toEqual(['/tasks/leaderboard']);
  });

  it('REL-04 a payload that names no real outage is refused', async () => {
    expect((await run({ orgId: 'org-a', attemptId: 'att-1' })).statusCode).toBe(400);
  });
});
