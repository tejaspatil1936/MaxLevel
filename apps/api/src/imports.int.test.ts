import { readFileSync } from 'node:fs';
import { IMPORT_MAX_BYTES } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from './firebase';
import { testApp } from './test-support/app';
import { NOW } from './test-support/attempts';
import { clearEmulators } from './test-support/emulators';
import { SCENARIOS } from './test-support/scenarios';
import { SEED, seedBase } from './test-support/seed';
import { asClaims } from './test-support/tokens';

// POST /v1/imports, the signed upload link, start, the job list and view, on the emulators (IMP-01, IMP-02, IMP-08,
// SEC-06, API-02, ORG-05).

const { db, auth } = initFirebase();
const org = `organizations/${SEED.orgA}`;
let ctx: Awaited<ReturnType<typeof testApp>>;
let testId: string;

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
  ctx = await testApp();
  ctx.clock.set(NOW);
  const seeded = await SCENARIOS['authoring-test']!(db, NOW, { orgId: SEED.orgA, questions: 'none' }, ctx.queue);
  testId = seeded.testId as string;
});

type Res = { status: number; body: Record<string, unknown> };
const admin = () => asClaims(auth, 'admin1@a.test', { role: 'admin', orgId: SEED.orgA });
const adminB = () => asClaims(auth, 'admin1@b.test', { role: 'admin', orgId: SEED.orgB });
let keys = 0;
const create = async (filename: string, sizeBytes = 100, headers?: Record<string, string>): Promise<Res> => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/imports',
    headers: { ...(headers ?? (await admin())), 'idempotency-key': `k${++keys}` },
    payload: { testId, filename, contentType: 'application/octet-stream', sizeBytes },
  });
  return { status: res.statusCode, body: res.json() };
};
const upload = async (url: string, bytes: Buffer, contentType = 'application/json') => {
  const u = new URL(url);
  const res = await ctx.app.inject({
    method: 'PUT',
    url: `${u.pathname}${u.search}`,
    headers: { 'content-type': contentType },
    payload: bytes,
  });
  return res.statusCode;
};
const start = async (id: string, headers?: Record<string, string>): Promise<Res> => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/imports/${id}/start`,
    headers: headers ?? (await admin()),
    payload: {},
  });
  return { status: res.statusCode, body: res.json() };
};
const code = (r: Res) => (r.body.error as { code?: string } | undefined)?.code;
const job = async (id: string) => (await db.doc(`${org}/importJobs/${id}`).get()).data();
const jobs = async () => (await db.collection(`${org}/importJobs`).get()).size;
const tasks = async () => (await ctx.queue.pending()).filter((t) => t.path === '/tasks/import');
const stored = async (path: string) => {
  const [exists] = await ctx.firebase.bucket.file(path).exists();
  return exists ? (await ctx.firebase.bucket.file(path).download())[0] : null;
};
const JSON_FILE = Buffer.from('{"format": "mitaoe-questions/1", "questions": []}');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

describe('import upload and job API', () => {
  it('IMP-01 SEC-06 creates the job awaiting its upload with its audit entry; the signed link stores the file', async () => {
    const created = await create('Paper.PDF');
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toEqual({
      id,
      status: 'awaiting_upload',
      uploadUrl: expect.stringMatching(new RegExp(`^http://localhost(:\\d+)?/v1/imports/${id}/upload\\?`)),
      uploadExpiresAt: NOW + 900_000,
    });
    expect(await job(id)).toEqual({
      orgId: SEED.orgA,
      testId,
      filename: 'Paper.PDF',
      format: 'pdf',
      contentType: 'application/octet-stream',
      sizeBytes: 100,
      filePath: `${org}/imports/${id}/source.pdf`,
      status: 'awaiting_upload',
      progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
      createdBy: expect.any(String),
      createdAt: NOW,
    });
    const audit = (await db.collection(`${org}/auditLogs`).where('action', '==', 'import.create').get()).docs;
    expect(audit.map((d) => d.data())).toEqual([
      expect.objectContaining({
        target: { type: 'importJob', id },
        after: { testId, filename: 'Paper.PDF', format: 'pdf' },
        actor: expect.objectContaining({ email: 'admin1@a.test', role: 'admin' }),
      }),
    ]);
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    expect(await upload(created.body.uploadUrl as string, pdf, 'application/pdf')).toBe(200);
    expect((await stored(`${org}/imports/${id}/source.pdf`))?.equals(pdf)).toBe(true);
    const tampered = (created.body.uploadUrl as string).replace(/sig=[0-9a-f]/, 'sig=0');
    expect(await upload(tampered, pdf)).toBe(403);
  });

  it('IMP-01 IMP-02 refuses other formats and a declared size over 25 MB, storing nothing; org B gets 404', async () => {
    for (const name of ['notes.docx', 'diagram.png', 'README'])
      expect(code(await create(name))).toBe('UNSUPPORTED_FORMAT');
    const big = await create('paper.pdf', IMPORT_MAX_BYTES + 1);
    expect([big.status, code(big)]).toEqual([400, 'FILE_TOO_LARGE']);
    expect((await create('paper.pdf', IMPORT_MAX_BYTES)).status).toBe(201);
    expect((await create('questions.json', 10, await adminB())).status).toBe(404);
    expect(await jobs()).toBe(1);
  });

  it('IMP-02 SEC-06 the link refuses a body over 25 MB, an expired link and a started job; start checks the stored object', async () => {
    const a = await create('questions.json');
    const url = a.body.uploadUrl as string;
    expect(await upload(url, Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x20))).toBe(413);
    expect(await stored(`${org}/imports/${a.body.id}/source.json`)).toBeNull();
    const missing = await start(a.body.id as string);
    expect([missing.status, code(missing)]).toEqual([409, 'UPLOAD_MISSING']);
    expect(await upload(url, JSON_FILE)).toBe(200);
    const started = await start(a.body.id as string);
    expect([started.status, started.body]).toEqual([202, { id: a.body.id, status: 'queued' }]);
    expect(await start(a.body.id as string)).toEqual({ status: 202, body: { id: a.body.id, status: 'queued' } });
    expect(await tasks()).toEqual([{ name: `import-${a.body.id}`, path: '/tasks/import', scheduleTime: NOW }]);
    expect(await upload(url, PNG)).toBe(409);
    expect((await stored(`${org}/imports/${a.body.id}/source.json`))?.equals(JSON_FILE)).toBe(true);

    const fake = await create('paper.pdf');
    expect(await upload(fake.body.uploadUrl as string, PNG)).toBe(200);
    const mismatch = await start(fake.body.id as string);
    expect([mismatch.status, mismatch.body]).toEqual([
      400,
      {
        error: {
          code: 'FILE_SIGNATURE_MISMATCH',
          message: "This file isn't a real PDF file. Check the file and try again.",
          details: {},
        },
      },
    ]);
    expect(await job(fake.body.id as string)).toMatchObject({
      status: 'failed',
      error: { code: 'FILE_SIGNATURE_MISMATCH', retryable: false },
    });

    // An object over the limit that reached Storage another way is refused on start too.
    const huge = await create('big.pdf');
    await ctx.firebase.bucket
      .file(`${org}/imports/${huge.body.id}/source.pdf`)
      .save(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(IMPORT_MAX_BYTES)]), { resumable: false });
    expect(code(await start(huge.body.id as string))).toBe('FILE_TOO_LARGE');
    expect(await job(huge.body.id as string)).toMatchObject({ status: 'failed', error: { code: 'FILE_TOO_LARGE' } });
    expect(await tasks(), 'no task for a refused start').toHaveLength(1);

    const late = await create('late.json');
    ctx.clock.advance(900_001);
    expect(await upload(late.body.uploadUrl as string, JSON_FILE)).toBe(403);
    expect(await stored(`${org}/imports/${late.body.id}/source.json`)).toBeNull();
  });

  it('IMP-08 AI formats are refused at the month limit and while ai_question_import is off; JSON is not', async () => {
    await db.doc(org).update({ limitOverrides: { ai_imports_per_month: 2 } });
    await db.doc(`${org}/usage/2026-11`).set({ aiImports: 2 });
    for (const name of ['paper.pdf', 'notes.txt', 'notes.md']) {
      const r = await create(name);
      expect([r.status, r.body.error]).toEqual([
        409,
        {
          code: 'LIMIT_REACHED',
          message: "This month's AI import limit (2) is used up. JSON files and template sheets can still be imported.",
          details: { limit: 'ai_imports_per_month', max: 2 },
        },
      ]);
    }
    for (const name of ['questions.json', 'sheet.csv', 'sheet.xlsx']) expect((await create(name)).status).toBe(201);
    expect(await jobs()).toBe(3);

    await db.doc(org).update({ featureOverrides: { ai_question_import: false } });
    const fresh = await testApp();
    const off = await fresh.app.inject({
      method: 'POST',
      url: '/v1/imports',
      headers: { ...(await admin()), 'idempotency-key': 'off-1' },
      payload: { testId, filename: 'paper.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    });
    expect([off.statusCode, off.json().error.code]).toEqual([403, 'FEATURE_DISABLED']);
  });

  it("IMP-01 lists a test's jobs newest first and shows a job without drafts until it is ready; org B gets 404", async () => {
    const first = await create('a.json');
    ctx.clock.advance(1000);
    const second = await create('b.csv');
    const headers = await admin();
    const list = await ctx.app.inject({ method: 'GET', url: `/v1/imports?testId=${testId}`, headers });
    expect(list.json()).toEqual({
      items: [
        {
          id: second.body.id,
          filename: 'b.csv',
          format: 'csv',
          status: 'awaiting_upload',
          pendingCount: 0,
          createdAt: NOW + 1000,
        },
        {
          id: first.body.id,
          filename: 'a.json',
          format: 'json',
          status: 'awaiting_upload',
          pendingCount: 0,
          createdAt: NOW,
        },
      ],
    });
    const view = await ctx.app.inject({ method: 'GET', url: `/v1/imports/${first.body.id}`, headers });
    expect(view.json()).toEqual({
      id: first.body.id,
      testId,
      filename: 'a.json',
      format: 'json',
      status: 'awaiting_upload',
      progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
      createdAt: NOW,
      drafts: [],
    });
    const b = await adminB();
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/imports/${first.body.id}`, headers: b })).statusCode).toBe(
      404,
    );
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/imports?testId=${testId}`, headers: b })).statusCode).toBe(
      404,
    );
    expect((await start(first.body.id as string, b)).status).toBe(404);
  });

  it('SEC-06 the API depends on no file parser: parsing happens only in the worker', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const parser of ['exceljs', 'papaparse', 'pdf-lib', 'pdfjs-dist', 'unpdf'])
      expect(Object.keys(pkg.dependencies), parser).not.toContain(parser);
  });
});
