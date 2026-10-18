import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { clearEmulators } from './test-support/emulators';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

const { db, auth } = initFirebase();
const orgA = SEED.orgA;
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: orgA });
const testPath = `organizations/${orgA}/tests/t1`;
const body = (prompt: string, correct: string[] = ['b']) => ({
  prompt,
  options: [
    { id: 'a', text: '25' },
    { id: 'b', text: '30' },
    { id: 'c', text: ' ' },
  ],
  correctOptionIds: correct,
});

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, 1_700_000_000_000);
  await db.doc(testPath).set({
    orgId: orgA,
    seriesId: 's1',
    title: 'Aptitude',
    dayHidden: false,
    scheduledDate: '2026-11-02',
    overrides: {},
    sections: [{ id: 'sec-1', name: 'Quant', order: 1, instructions: '', forwardOnly: false }],
    status: 'draft',
    questionSetVersion: 1,
    totalMarks: 0,
    attemptsStarted: false,
    createdAt: 0,
    updatedAt: 0,
  });
});

type App = Awaited<ReturnType<typeof testApp>>['app'];
const call = async (app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: await admin(), ...(payload ? { payload } : {}) });
const add = async (app: App, payload: object) => {
  const res = await call(app, 'POST', '/v1/tests/t1/questions', payload);
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; status: string };
};
const audit = async (action: string) =>
  (await db.collection(`organizations/${orgA}/auditLogs`).where('action', '==', action).get()).docs.map((d) =>
    d.data(),
  );
const stored = async (id: string) => (await db.doc(`${testPath}/questions/${id}`).get()).data();
type Listed = { id: string; status: string; problems: Array<{ code: string }> };
const list = async (app: App) =>
  ((await call(app, 'GET', '/v1/tests/t1/questions')).json() as { items: Listed[] }).items;

describe('question routes', () => {
  it('Q-01 TST-04 a question that passes the checks is stored approved and moves a draft test to review', async () => {
    const { app } = await testApp();
    const saved = await add(app, { ...body('What is 15% of 200?'), difficulty: 'medium', tags: ['percentages'] });
    expect(saved.status).toBe('approved');
    expect(await stored(saved.id)).toMatchObject({
      orgId: orgA,
      testId: 't1',
      order: 1,
      type: 'single',
      status: 'approved',
      source: { kind: 'manual' },
      difficulty: 'medium',
      tags: ['percentages'],
      options: [
        { id: 'a', text: '25' },
        { id: 'b', text: '30' },
      ],
    });
    const test = (await db.doc(testPath).get()).data();
    expect(test).toMatchObject({ status: 'in_review', questionSetVersion: 2 });
    const [entry] = await audit('question.create');
    expect(entry).toMatchObject({ target: { type: 'question', id: saved.id }, actor: { role: 'admin' } });
  });

  it('Q-01 a question with problems is stored as a draft and listed with its reasons, duplicates by position', async () => {
    const { app } = await testApp();
    const first = await add(app, body('What is 15% of 200?'));
    const noAnswer = await add(app, body('Which is prime?', []));
    const dup = await add(app, body('what is 15%  of 200'));
    expect([first.status, noAnswer.status, dup.status]).toEqual(['approved', 'draft', 'draft']);
    expect(await stored(noAnswer.id)).toMatchObject({ status: 'draft', correctOptionIds: [], order: 2 });
    const items = await list(app);
    expect(items.map((q) => [q.id, q.problems])).toEqual([
      [first.id, []],
      [noAnswer.id, [{ code: 'NO_CORRECT_ANSWER' }]],
      [dup.id, [{ code: 'DUPLICATE', of: 1 }]],
    ]);
  });

  it('Q-01 AUD-01 an edit is checked again, null clears a field, and the change is audit-logged without the key', async () => {
    const { app } = await testApp();
    const q = await add(app, { ...body('Which is prime?', []), explanation: 'Only 23.', sectionId: 'sec-1' });
    const res = await call(app, 'PATCH', `/v1/tests/t1/questions/${q.id}`, {
      correctOptionIds: ['a'],
      explanation: null,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: q.id, status: 'approved' });
    const after = await stored(q.id);
    expect(after).toMatchObject({ status: 'approved', correctOptionIds: ['a'], sectionId: 'sec-1' });
    expect(after).not.toHaveProperty('explanation');
    // AUD-01: the answer key and the explanation never reach the audit log.
    expect(await audit('question.update')).toEqual([
      expect.objectContaining({
        target: { type: 'question', id: q.id },
        before: { status: 'draft' },
        after: { status: 'approved' },
      }),
    ]);
    const removed = await call(app, 'PATCH', `/v1/tests/t1/questions/${q.id}`, {
      options: [{ id: 'b', text: '30' }],
    });
    expect(removed.json()).toEqual({ id: q.id, status: 'draft' });
    expect(await stored(q.id)).toMatchObject({ correctOptionIds: [] });
    expect((await call(app, 'PATCH', '/v1/tests/t1/questions/missing', { prompt: 'X' })).statusCode).toBe(404);
  });

  it('Q-01 deleting a question keeps the others in order and numbers them again', async () => {
    const { app } = await testApp();
    const [a, b, c] = [await add(app, body('One')), await add(app, body('Two')), await add(app, body('Three'))];
    const res = await call(app, 'DELETE', `/v1/tests/t1/questions/${b!.id}`);
    expect(res.statusCode).toBe(200);
    expect(await stored(b!.id)).toBeUndefined();
    expect((await list(app)).map((q) => q.id)).toEqual([a!.id, c!.id]);
    expect((await stored(c!.id))?.order).toBe(2);
    expect(await audit('question.delete')).toHaveLength(1);
  });

  it("ORG-05 A11Y-10 a question may name only its own test's images and sections", async () => {
    const { app } = await testApp();
    const foreign = await call(app, 'POST', '/v1/tests/t1/questions', {
      ...body('Which shape?'),
      images: [{ path: `organizations/${SEED.orgB}/logo.png`, alt: 'Logo' }],
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.details).toEqual({ field: 'images' });
    const climb = await call(app, 'POST', '/v1/tests/t1/questions', {
      ...body('Which shape?'),
      images: [{ path: `${testPath}/images/../../t2/images/x.png`, alt: 'X' }],
    });
    expect(climb.statusCode).toBe(400);
    const section = await call(app, 'POST', '/v1/tests/t1/questions', { ...body('Which?'), sectionId: 'other' });
    expect(section.json().error.details).toEqual({ field: 'sectionId' });
    const noAlt = await add(app, { ...body('Which shape?'), images: [{ path: `${testPath}/images/x.png`, alt: '' }] });
    expect(noAlt.status).toBe('draft');
    expect((await list(app))[0]?.problems).toEqual([{ code: 'IMAGE_WITHOUT_ALT', image: 1 }]);
    expect((await db.collection(`${testPath}/questions`).get()).size).toBe(1);
  });
});

describe('question order, import and images', () => {
  it('Q-01 the order is saved as given, and a list that is not exactly the test questions is refused', async () => {
    const { app } = await testApp();
    const ids = [await add(app, body('One')), await add(app, body('Two')), await add(app, body('Three'))].map(
      (q) => q.id,
    );
    const reversed = [...ids].reverse();
    const res = await call(app, 'PUT', '/v1/tests/t1/questions/order', { ids: reversed });
    expect(res.statusCode).toBe(200);
    expect((await list(app)).map((q) => q.id)).toEqual(reversed);
    const [entry] = await audit('question.reorder');
    expect(entry).toMatchObject({ target: { type: 'test', id: 't1' }, after: { ids: reversed } });
    for (const bad of [ids.slice(1), [...ids, 'other'], [ids[0], ids[0], ids[1]]]) {
      const refused = await call(app, 'PUT', '/v1/tests/t1/questions/order', { ids: bad });
      expect(refused.statusCode).toBe(400);
    }
    expect((await list(app)).map((q) => q.id)).toEqual(reversed);
  });

  it('Q-01 TST-04 imported questions are appended in order as json, each checked, with one audit entry', async () => {
    const { app } = await testApp();
    await add(app, body('Existing question'));
    const res = await call(app, 'POST', '/v1/tests/t1/questions/import', {
      questions: [body('Imported one'), body('Imported two', []), body('existing question')],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ count: 3 });
    const items = await list(app);
    expect(items.map((q) => [q.status, q.problems])).toEqual([
      ['approved', []],
      ['approved', []],
      ['draft', [{ code: 'NO_CORRECT_ANSWER' }]],
      ['draft', [{ code: 'DUPLICATE', of: 1 }]],
    ]);
    const docs = (await db.collection(`${testPath}/questions`).get()).docs.map((d) => d.data());
    expect(docs.filter((d) => d.source.kind === 'json')).toHaveLength(3);
    expect(Math.max(...docs.map((d) => d.order))).toBe(4);
    const [entry] = await audit('question.import');
    expect(entry).toMatchObject({ target: { type: 'test', id: 't1' }, after: { count: 3 } });
  });

  it('A11Y-10 SEC-06 an uploaded image is stored for this test, listed as a data URL, and a fake one is refused', async () => {
    const { app } = await testApp();
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const up = await call(app, 'POST', '/v1/tests/t1/question-images', { contentType: 'image/png', data: png });
    expect(up.statusCode).toBe(201);
    const { path, url } = up.json() as { path: string; url: string };
    expect(path.startsWith(`${testPath}/images/`)).toBe(true);
    await add(app, { ...body('Which shape?'), images: [{ path, alt: 'A red square' }] });
    const listed = (await call(app, 'GET', '/v1/tests/t1/questions')).json() as { imageUrls: Record<string, string> };
    expect(listed.imageUrls).toEqual({ [path]: url });
    const fake = await call(app, 'POST', '/v1/tests/t1/question-images', {
      contentType: 'image/png',
      data: Buffer.from('<html></html>').toString('base64'),
    });
    expect(fake.statusCode).toBe(400);
    expect(
      (await call(app, 'POST', '/v1/tests/none/question-images', { contentType: 'image/png', data: png })).statusCode,
    ).toBe(404);
  });
});
