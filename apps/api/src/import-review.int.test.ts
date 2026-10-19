import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SCENARIOS } from './test-support/scenarios';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// The routes after the worker: retry, source pages, draft edits, discard and approval, on the emulators (REL-06,
// IMP-03, IMP-11, IMP-12, ORG-05).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let testId: string;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  ctx.clock.set(NOW);
  const seeded = await SCENARIOS['authoring-test']!(db, NOW, { orgId: SEED.orgA }, ctx.queue);
  testId = seeded.testId as string;
});

type Res = { status: number; body: Record<string, unknown> };
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const adminB = () => asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, headers?: object) => {
  const res = await ctx.app.inject({
    method,
    url,
    headers: { ...(headers ?? (await admin())) },
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> } as Res;
};
const code = (r: Res) => (r.body.error as { code?: string } | undefined)?.code;
const jobRef = (id: string) => db.doc(`${org}/importJobs/${id}`);
const tasks = async () => (await ctx.queue.pending()).filter((t) => t.path === '/tasks/import');

/** A stored job in org A's test, with these fields over a ready three-page PDF job. */
async function storeJob(id: string, fields: Record<string, unknown> = {}) {
  await jobRef(id).set({
    orgId: SEED.orgA,
    testId,
    filename: 'paper.pdf',
    format: 'pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    filePath: `${org}/imports/${id}/source.pdf`,
    status: 'ready',
    progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 0 },
    createdBy: 'uid-1',
    createdAt: NOW,
    ...fields,
  });
}

describe('import retry', () => {
  it('REL-06 IMP-08 a retryable failure is queued again with its audit entry; pages, counter and usage are kept', async () => {
    await storeJob('j1', {
      status: 'failed',
      error: { code: 'LLM_UNAVAILABLE', message: "The AI service didn't answer after 4 tries.", retryable: true },
      failures: 4,
      aiCounted: true,
      progress: { pagesDone: 1, pagesTotal: 3, questionsFound: 2 },
    });
    const res = await call('POST', '/v1/imports/j1/retry', {});
    expect(res).toEqual({ status: 202, body: { id: 'j1', status: 'queued' } });
    const job = (await jobRef('j1').get()).data()!;
    expect(job).toMatchObject({ status: 'queued', failures: 0, aiCounted: true, progress: { pagesDone: 1 } });
    expect(job.error).toBeUndefined();
    const queued = await tasks();
    expect(queued.map((t) => [t.scheduleTime, t.name.includes('j1')])).toEqual([[NOW, true]]);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'import.retry').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({
        target: { type: 'importJob', id: 'j1' },
        actor: expect.objectContaining({ email: 'admin1@a.test' }),
      }),
    ]);

    // Queued now, it is no longer retryable.
    const again = await call('POST', '/v1/imports/j1/retry', {});
    expect([again.status, code(again)]).toEqual([409, 'IMPORT_NOT_RETRYABLE']);
    expect(await tasks()).toHaveLength(1);
  });

  it('REL-06 ORG-05 a job that is not a retryable failure is refused, and another organization gets 404', async () => {
    await storeJob('ready');
    await storeJob('limit', {
      status: 'failed',
      error: { code: 'TOO_MANY_PAGES', message: 'x', retryable: false },
    });
    await storeJob('waiting', {
      status: 'retrying',
      error: { code: 'LLM_UNAVAILABLE', message: 'x', retryable: true },
    });
    for (const id of ['ready', 'limit', 'waiting']) {
      const res = await call('POST', `/v1/imports/${id}/retry`, {});
      expect([res.status, code(res)], id).toEqual([409, 'IMPORT_NOT_RETRYABLE']);
    }
    await storeJob('j2', { status: 'failed', error: { code: 'LLM_UNAVAILABLE', message: 'x', retryable: true } });
    expect((await call('POST', '/v1/imports/j2/retry', {}, await adminB())).status).toBe(404);
    expect((await jobRef('j2').get()).get('status')).toBe('failed');
    expect(await tasks()).toEqual([]);
  });
});

describe('import source pages', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const follow = async (url: string) => {
    const u = new URL(url);
    return ctx.app.inject({ method: 'GET', url: `${u.pathname}${u.search}` });
  };

  it('IMP-03 DATA-09 a kept page is served through a signed link for 15 minutes, as PNG or one-page PDF', async () => {
    await storeJob('j1');
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/1.png`).save(PNG, { contentType: 'image/png' });
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/2.pdf`).save(pdf, { contentType: 'application/pdf' });

    const link = await call('GET', '/v1/imports/j1/pages/1');
    expect(link).toEqual({
      status: 200,
      body: {
        url: expect.stringMatching(/\/v1\/imports\/j1\/pages\/1\/file\?/),
        contentType: 'image/png',
        expiresAt: NOW + 900_000,
      },
    });
    const got = await follow(link.body.url as string);
    expect([got.statusCode, got.headers['content-type']]).toEqual([200, 'image/png']);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await call('GET', '/v1/imports/j1/pages/2')).body.contentType).toBe('application/pdf');

    // A link names its page: changing the page or the signature, or waiting past the expiry, is refused.
    expect((await follow((link.body.url as string).replace('/pages/1/', '/pages/2/'))).statusCode).toBe(403);
    expect((await follow((link.body.url as string).replace(/sig=[0-9a-f]/, 'sig=x'))).statusCode).toBe(403);
    ctx.clock.advance(900_000);
    expect((await follow(link.body.url as string)).statusCode).toBe(403);
  });

  it('IMP-03 ORG-05 no link for a page out of range, not kept, of another format or of another organization', async () => {
    await storeJob('j1');
    await storeJob('json', { format: 'json', progress: { pagesDone: 1, pagesTotal: 1, questionsFound: 0 } });
    await ctx.firebase.bucket.file(`${org}/imports/j1/pages/1.png`).save(PNG, { contentType: 'image/png' });
    for (const url of ['/v1/imports/j1/pages/4', '/v1/imports/j1/pages/3', '/v1/imports/json/pages/1'])
      expect((await call('GET', url)).status, url).toBe(404);
    expect((await call('GET', '/v1/imports/j1/pages/0')).status).toBe(400);
    expect((await call('GET', '/v1/imports/j1/pages/1', undefined, await adminB())).status).toBe(404);
  });
});

/** A pending draft as the worker stores it. */
const draftDoc = (order: number, prompt: string, extra: Record<string, unknown> = {}) => ({
  order,
  sourcePage: 1,
  prompt,
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  correctOptionIds: ['b'],
  difficulty: 'easy',
  difficultySuggested: true,
  images: [],
  flags: [],
  status: 'pending',
  ...extra,
});
const DUP1 = [{ code: 'DUPLICATE_IN_IMPORT', text: 'This looks like a duplicate of imported question 1.' }];
const FIG = `${org}/imports/j1/figures/d0003-1.png`;

/** A ready job `j1` with three drafts: 2 duplicates 1, and 3 has an image without alt text. */
async function storeDrafts() {
  await storeJob('j1');
  const drafts = jobRef('j1').collection('drafts');
  await drafts.doc('d0001').set(draftDoc(1, 'What is 7 x 8?'));
  await drafts.doc('d0002').set(draftDoc(2, 'What is 7 x 8?', { flags: DUP1 }));
  await drafts.doc('d0003').set(
    draftDoc(3, 'Which bar is tallest?', {
      images: [{ path: FIG, alt: '' }],
      flags: [{ code: 'IMAGE_WITHOUT_ALT', text: 'Image 1 has no alt text.' }],
    }),
  );
}
const stored = async (id: string) => (await jobRef('j1').collection('drafts').doc(id).get()).data()!;

describe('import draft edits', () => {
  it('IMP-11 IMP-09 an edit returns the draft checked again, and every other pending draft is rechecked', async () => {
    await storeDrafts();
    const res = await call('PATCH', '/v1/imports/j1/drafts/d0001', { prompt: 'What is 9 x 8?', difficulty: 'hard' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'd0001',
      prompt: 'What is 9 x 8?',
      difficulty: 'hard',
      difficultySuggested: false,
      flags: [],
    });
    expect((await stored('d0001')).prompt).toBe('What is 9 x 8?');
    expect((await stored('d0002')).flags, 'no longer a duplicate').toEqual([]);

    const noAnswer = await call('PATCH', '/v1/imports/j1/drafts/d0002', { correctOptionIds: [], explanation: '' });
    expect(noAnswer.body.flags).toEqual([
      { code: 'NO_CORRECT_ANSWER', text: 'No correct answer found in the source.' },
    ]);
    expect(noAnswer.body).not.toHaveProperty('explanation');

    const alt = await call('PATCH', '/v1/imports/j1/drafts/d0003', { images: [{ path: FIG, alt: 'Bar chart' }] });
    expect(alt.body).toMatchObject({ images: [{ path: FIG, alt: 'Bar chart' }], flags: [] });
  });

  it('ORG-05 IMP-11 an image path the draft does not have is refused and nothing is stored', async () => {
    await storeDrafts();
    for (const path of [`organizations/${SEED.orgB}/tests/x/images/y.png`, `${org}/tests/${testId}/images/other.png`]) {
      const res = await call('PATCH', '/v1/imports/j1/drafts/d0003', {
        images: [{ path, alt: 'x' }],
        prompt: 'Changed',
      });
      expect([res.status, code(res)], path).toEqual([400, 'VALIDATION']);
    }
    expect(await stored('d0003')).toMatchObject({ prompt: 'Which bar is tallest?', images: [{ path: FIG, alt: '' }] });
    expect((await call('PATCH', '/v1/imports/j1/drafts/d0001', { prompt: 'x' }, await adminB())).status).toBe(404);
    expect((await call('PATCH', '/v1/imports/j1/drafts/nope', { prompt: 'x' })).status).toBe(404);
    expect((await call('PATCH', '/v1/imports/j1/drafts/d0001', {})).status).toBe(400);
  });

  it('IMP-11 only a pending draft of a ready job can change', async () => {
    await storeDrafts();
    await jobRef('j1').collection('drafts').doc('d0001').update({ status: 'discarded' });
    const res = await call('PATCH', '/v1/imports/j1/drafts/d0001', { prompt: 'x' });
    expect([res.status, code(res)]).toEqual([409, 'DRAFT_NOT_PENDING']);
    await jobRef('j1').update({ status: 'running' });
    const running = await call('PATCH', '/v1/imports/j1/drafts/d0002', { prompt: 'x' });
    expect([running.status, code(running)]).toEqual([409, 'IMPORT_NOT_READY']);
  });
});

describe('import discard', () => {
  it('IMP-12 IMP-09 discards pending drafts with an audit entry and rechecks the rest', async () => {
    await storeDrafts();
    const res = await call('POST', '/v1/imports/j1/discard', { draftIds: ['d0001'] });
    expect(res).toEqual({ status: 200, body: { discarded: 1 } });
    expect((await stored('d0001')).status).toBe('discarded');
    expect((await stored('d0002')).flags, 'its original is discarded').toEqual([]);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'import.discard').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({ target: { type: 'importJob', id: 'j1' }, after: { count: 1 } }),
    ]);

    const again = await call('POST', '/v1/imports/j1/discard', { draftIds: ['d0002', 'd0001'] });
    expect([again.status, code(again)]).toEqual([409, 'DRAFT_NOT_PENDING']);
    expect((await stored('d0002')).status, 'a refusal changes nothing').toBe('pending');
    expect((await call('POST', '/v1/imports/j1/discard', { draftIds: ['nope'] })).status).toBe(404);
    expect((await call('POST', '/v1/imports/j1/discard', { draftIds: [] })).status).toBe(400);
    expect((await call('POST', '/v1/imports/j1/discard', { draftIds: ['d0002'] }, await adminB())).status).toBe(404);
  });
});

describe('import approval', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
  const testRef = () => db.doc(`${org}/tests/${testId}`);
  const questions = async () =>
    (await testRef().collection('questions').orderBy('order').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  /** storeDrafts, with draft 3 fixed (alt text) under the Reasoning heading and its figure stored. */
  async function readyToApprove() {
    await storeDrafts();
    await jobRef('j1').update({ provider: 'mock', model: 'mock-model' });
    await jobRef('j1')
      .collection('drafts')
      .doc('d0003')
      .update({ images: [{ path: FIG, alt: 'Bar chart' }], flags: [], sectionName: 'reasoning', sourcePage: 2 });
    await ctx.firebase.bucket.file(FIG).save(PNG, { contentType: 'image/png' });
    await testRef().update({ sections: [{ id: 's1', name: 'Reasoning', order: 1, forwardOnly: false }] });
  }

  it('IMP-12 US-AD-06 appends one question per draft in draft order, with its source, section and copied image', async () => {
    await readyToApprove();
    const before = await questions();
    const res = await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0003', 'd0001'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const questionIds = res.body.questionIds as string[];
    const after = await questions();
    expect(after.map((q) => q.id)).toEqual([...before.map((q) => q.id), ...questionIds]);
    const [q1, q3] = after.slice(-2) as Array<Record<string, unknown>>;
    expect(q1).toMatchObject({
      order: before.length + 1,
      prompt: 'What is 7 x 8?',
      correctOptionIds: ['b'],
      difficulty: 'easy',
      status: 'approved',
      source: { kind: 'ai', jobId: 'j1', page: 1 },
    });
    expect(q1!.sectionId).toBeUndefined();
    expect(q3).toMatchObject({
      order: before.length + 2,
      sectionId: 's1',
      source: { kind: 'ai', jobId: 'j1', page: 2 },
    });
    const [img] = q3!.images as Array<{ path: string; alt: string }>;
    expect(img!.path.startsWith(`${org}/tests/${testId}/images/`)).toBe(true);
    expect(img!.alt).toBe('Bar chart');
    expect((await ctx.firebase.bucket.file(img!.path).download())[0].equals(PNG)).toBe(true);

    // The IDs come in draft order, whatever the order of the list.
    expect(await stored('d0001')).toMatchObject({ status: 'approved', questionId: questionIds[0] });
    expect(await stored('d0003')).toMatchObject({ status: 'approved', questionId: questionIds[1] });
    expect((await stored('d0002')).flags, 'now a duplicate of the test question').toEqual([
      { code: 'DUPLICATE_IN_TEST', text: `This looks like a duplicate of question ${before.length + 1} in the test.` },
    ]);
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'question.import').get()).docs;
    expect(audit.map((d) => d.data().after)).toEqual([{ count: 2, ids: questionIds, jobId: 'j1' }]);
    expect((await testRef().get()).get('status')).toBe('in_review');
  });

  it('IMP-10 IMP-12 one flagged or non-pending draft refuses the whole list, changing nothing', async () => {
    await readyToApprove();
    const before = (await questions()).length;
    const flagged = await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0001', 'd0002'] });
    expect([flagged.status, code(flagged)]).toEqual([409, 'DRAFTS_FLAGGED']);
    expect((flagged.body.error as { details: unknown }).details).toEqual({ draftIds: ['d0002'] });
    await jobRef('j1').collection('drafts').doc('d0003').update({ status: 'discarded' });
    const done = await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0001', 'd0003'] });
    expect([done.status, code(done)]).toEqual([409, 'DRAFT_NOT_PENDING']);
    expect((await call('POST', '/v1/imports/j1/approve', { draftIds: [] })).status).toBe(400);
    expect((await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0001'] }, await adminB())).status).toBe(404);
    expect((await stored('d0001')).status).toBe('pending');
    expect(await questions()).toHaveLength(before);
  });

  it('IMP-12 TST-06 nothing is approved before the job is ready or once an attempt has started', async () => {
    await readyToApprove();
    await jobRef('j1').update({ status: 'running' });
    const running = await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0001'] });
    expect([running.status, code(running)]).toEqual([409, 'IMPORT_NOT_READY']);
    await jobRef('j1').update({ status: 'ready' });
    await testRef().update({ attemptsStarted: true });
    const locked = await call('POST', '/v1/imports/j1/approve', { draftIds: ['d0001'] });
    expect([locked.status, code(locked)]).toEqual([409, 'TEST_LOCKED']);
    expect((await stored('d0001')).status).toBe('pending');
  });
});
