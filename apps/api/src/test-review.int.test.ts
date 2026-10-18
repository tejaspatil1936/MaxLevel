import { RELEASE_SETTING_KEYS } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SCENARIOS } from './test-support/scenarios';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const testDoc = (id: string) => db.doc(`organizations/${orgA}/tests/${id}`);

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
});

type App = Awaited<ReturnType<typeof testApp>>['app'];
type Method = 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = async (app: App, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: await admin(), ...(payload ? { payload } : {}) });

/** The `authoring-test` scenario, published (status `scheduled`, approval and snapshot set), or only approved. */
async function seeded(approvedOnly = false) {
  const r = await SCENARIOS['authoring-test']!(db, 1_700_000_000_000, {
    orgId: orgA,
    questions: 'sectioned',
    publish: true,
  });
  const testId = r.testId as string;
  if (approvedOnly) await testDoc(testId).update({ status: 'approved' });
  return { testId, questionIds: r.questionIds as string[], sectionIds: r.sectionIds as Record<string, string> };
}
const question = {
  prompt: 'What is 3 + 3?',
  options: [
    { id: 'a', text: '6' },
    { id: 'b', text: '7' },
  ],
  correctOptionIds: ['a'],
};
const sectionsOf = async (id: string) => (await testDoc(id).get()).get('sections') as Array<Record<string, unknown>>;

/** Every edit that changes what approval checked (Q-15): the request it sends, given the seeded test. */
const LOCKED: Record<string, (t: Awaited<ReturnType<typeof seeded>>) => Promise<[Method, string, object?]>> = {
  'adding a question': async (t) => ['POST', `/v1/tests/${t.testId}/questions`, question],
  'editing a question': async (t) => [
    'PATCH',
    `/v1/tests/${t.testId}/questions/${t.questionIds[0]}`,
    { prompt: 'Quant easy one' },
  ],
  'deleting a question': async (t) => ['DELETE', `/v1/tests/${t.testId}/questions/${t.questionIds[1]}`],
  'reordering questions': async (t) => [
    'PUT',
    `/v1/tests/${t.testId}/questions/order`,
    { ids: [...t.questionIds].reverse() },
  ],
  'importing questions': async (t) => ['POST', `/v1/tests/${t.testId}/questions/import`, { questions: [question] }],
  'changing sections': async (t) => [
    'PATCH',
    `/v1/tests/${t.testId}`,
    { sections: (await sectionsOf(t.testId)).map((s) => ({ ...s, instructions: 'New instructions.' })) },
  ],
  'changing a draw': async (t) => [
    'PATCH',
    `/v1/tests/${t.testId}`,
    { sections: (await sectionsOf(t.testId)).map((s, i) => (i === 0 ? { ...s, drawCount: 3 } : s)) },
  ],
  'changing the marking': async (t) => [
    'PATCH',
    `/v1/tests/${t.testId}`,
    { overrides: { marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' } } },
  ],
  'changing time limits': async (t) => [
    'PATCH',
    `/v1/tests/${t.testId}`,
    { overrides: { questionTimeMode: 'same', questionTimeLimitSec: 60 } },
  ],
  'changing a locked setting': async (t) => ['PATCH', `/v1/tests/${t.testId}`, { overrides: { maxStrikes: 5 } }],
  'moving the date': async (t) => ['PATCH', `/v1/tests/${t.testId}`, { scheduledDate: '2026-11-04' }],
};

describe('Q-15 editing an approved or scheduled test before attempts', () => {
  for (const [edit, request] of Object.entries(LOCKED))
    it(`Q-15 ${edit} on a scheduled test returns it to in_review and removes approval and resolved`, async () => {
      const { app } = await testApp();
      const t = await seeded();
      const [method, url, body] = await request(t);
      expect((await call(app, method, url, body)).statusCode).toBeLessThan(300);
      const stored = (await testDoc(t.testId).get()).data()!;
      expect(stored.status).toBe('in_review');
      expect(stored).not.toHaveProperty('approval');
      expect(stored).not.toHaveProperty('resolved');
    });

  it('Q-15 an edit of an approved (not yet published) test returns it to in_review too', async () => {
    const { app } = await testApp();
    const t = await seeded(true);
    await call(app, 'PATCH', `/v1/tests/${t.testId}/questions/${t.questionIds[0]}`, { prompt: 'Changed' });
    expect((await testDoc(t.testId).get()).data()).toMatchObject({ status: 'in_review' });
    expect((await testDoc(t.testId).get()).get('approval')).toBeUndefined();
  });

  it('Q-15 TST-06 the release and visibility settings keep the status and update resolved in place', async () => {
    const { app } = await testApp();
    const t = await seeded();
    const before = (await testDoc(t.testId).get()).get('resolved');
    const overrides = {
      resultRelease: 'manual',
      resultDetail: 'score',
      showPastScores: false,
      testLeaderboard: true,
      seriesLeaderboard: true,
    };
    expect(Object.keys(overrides).sort()).toEqual([...RELEASE_SETTING_KEYS].sort());
    expect((await call(app, 'PATCH', `/v1/tests/${t.testId}`, { overrides })).statusCode).toBe(200);
    const stored = (await testDoc(t.testId).get()).data()!;
    expect(stored.status).toBe('scheduled');
    expect(stored.approval).toMatchObject({ status: 'approved' });
    expect(stored.resolved).toEqual({ ...before, ...overrides });
  });

  it('Q-15 SER-08 an eligibility edit or a rename keeps the status, the approval and the snapshot', async () => {
    const { app } = await testApp();
    const t = await seeded();
    const before = (await testDoc(t.testId).get()).data()!;
    const eligibility = { departmentIds: [], graduationYears: [2027], include: [], exclude: [] };
    expect((await call(app, 'PATCH', `/v1/tests/${t.testId}`, { eligibility })).statusCode).toBe(200);
    expect((await call(app, 'PATCH', `/v1/tests/${t.testId}`, { title: 'Renamed' })).statusCode).toBe(200);
    // Saving the sections and overrides unchanged is not an edit either.
    const same = { sections: before.sections, overrides: before.overrides };
    expect((await call(app, 'PATCH', `/v1/tests/${t.testId}`, same)).statusCode).toBe(200);
    const stored = (await testDoc(t.testId).get()).data()!;
    expect(stored).toMatchObject({ status: 'scheduled', approval: before.approval, resolved: before.resolved });
  });

  it('TST-06 Q-15 once an attempt exists an edit leaves the status alone (the lock itself comes with attempts)', async () => {
    const { app } = await testApp();
    const t = await seeded();
    await db.doc(`organizations/${orgA}/attemptIndex/${t.testId}_s1`).set({ activeAttemptId: 'a1', attemptCount: 1 });
    await call(app, 'PATCH', `/v1/tests/${t.testId}`, { overrides: { maxStrikes: 5 } });
    await call(app, 'PATCH', `/v1/tests/${t.testId}/questions/${t.questionIds[0]}`, { prompt: 'Changed' });
    const stored = (await testDoc(t.testId).get()).data()!;
    expect(stored.status).toBe('scheduled');
    expect(stored.resolved).toBeDefined();
  });
});
