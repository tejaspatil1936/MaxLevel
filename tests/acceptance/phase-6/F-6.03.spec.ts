import { AUTHORING_NOW, auditFor, storedPrompts } from '../fixtures/authoring';
import { putAnswers, startAttempt } from '../fixtures/exam';
import {
  fixtureQuestions,
  freeSheetCsv,
  JSON_QUESTIONS,
  llmFixture,
  questionsJson,
  quantPaperPdf,
  reasoningNotes,
  TEMPLATE_QUESTIONS,
  templateCsv,
  templateXlsx,
} from '../fixtures/import-files';
import {
  aiImportsUsed,
  correctText,
  draftByOrder,
  getJob,
  IMPORT_TEXTS,
  importFile,
  importReady,
  importTasks,
  isPng,
  QUANT_PAPER_FLAGS,
  retryImport,
  storageBytes,
  storedDrafts,
  storedJob,
  waitForJob,
  waitForJobState,
} from '../fixtures/imports';
import { fetchSigned } from '../fixtures/results';
import { accounts, ORG_A, ORG_B, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';

// F-6.03 Worker extraction pipeline (IMP-03, IMP-07, REL-06; with the checks of IMP-05 and IMP-09 as the worker
// stores them). Contract: docs/testids/phase-6.md, "Worker pipeline", "Draft", "Question checks on drafts" and
// "Test-only routes".

const paper = llmFixture('quant-paper');
const paperQuestions = fixtureQuestions(paper);
const MIN = 60_000;

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-6.03 worker extraction pipeline', () => {
  test('IMP-03 IMP-07 a PDF goes to the model one page per call as pages; figures are cropped and stored; provider, model, tokens and cost are recorded', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, usage: { inputTokens: 1000, outputTokens: 200 } });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());

    const calls = await testApi.llm.calls();
    expect(
      calls.map((c) => c.page),
      'one call per page, in page order',
    ).toEqual([1, 2, 3]);
    for (const c of calls) {
      const files = c.parts.filter((p) => p.type === 'file') as Array<{ type: 'file'; mediaType: string }>;
      expect(files.length, `page ${c.page} is sent as a page of the document`).toBeGreaterThanOrEqual(1);
      for (const f of files) expect(f.mediaType).toMatch(/^(application\/pdf|image\/png)$/);
    }

    expect(job.progress).toEqual({ pagesDone: 3, pagesTotal: 3, questionsFound: 9 });
    expect(job.provider).toBe('mock');
    expect(job.model).toBe('mock-model');
    expect(job.tokens).toEqual({ input: 3000, output: 600 });
    // 3,000 / 1e6 × $1 + 600 / 1e6 × $4
    expect(job.costEstimate).toBeCloseTo(0.0054, 6);
    const stored = await storedJob(emulators, ORG_A.id, job.id);
    expect(stored).toMatchObject({
      status: 'ready',
      provider: 'mock',
      model: 'mock-model',
      tokens: { input: 3000, output: 600 },
      aiCounted: true,
      progress: { pagesDone: 3, pagesTotal: 3, questionsFound: 9 },
    });
    expect(Number(stored.costEstimate)).toBeCloseTo(0.0054, 6);
    expect(await aiImportsUsed(emulators, ORG_A.id), 'one AI import, not one per page').toBe(1);

    expect(job.drafts.map((d) => d.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const q of paperQuestions) {
      const d = draftByOrder(job, q.order);
      expect(d.sourcePage, `draft ${q.order} page`).toBe(q.page);
      expect(d.box, `draft ${q.order} box`).toBeDefined();
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(d.box![k]).toBeCloseTo(q.box![k], 3);
    }

    // The bar chart of question 5 is cropped, stored as a PNG and attached with the model's alt text.
    const chart = draftByOrder(job, 5);
    expect(chart.images).toHaveLength(1);
    expect(chart.images[0]!.path.startsWith(`organizations/${ORG_A.id}/imports/${job.id}/figures/`)).toBe(true);
    expect(chart.images[0]!.alt).toBe(paperQuestions[4]!.figure!.alt);
    expect(isPng(await storageBytes(request, chart.images[0]!.path)), 'the cropped figure is a stored PNG').toBe(true);
    expect(draftByOrder(job, 3).images, 'no figure was located for question 3').toEqual([]);

    // Source pages are served through signed links.
    const pageLink = await admin.get<{ url: string; contentType: string; expiresAt: number }>(
      `/v1/imports/${job.id}/pages/2`,
    );
    expect(pageLink.status).toBe(200);
    expect(pageLink.body.contentType).toMatch(/^(application\/pdf|image\/png)$/);
    const fetched = await fetchSigned(request, pageLink.body.url);
    expect(fetched.status).toBe(200);
    expect(fetched.body.length).toBeGreaterThan(0);
    expect((await admin.get(`/v1/imports/${job.id}/pages/4`)).status, 'no page 4').toBe(404);
  });

  test('IMP-05 IMP-09 IMP-10 drafts keep the source wording and its answers, and every check flags its question with a plain reason', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());

    for (const q of paperQuestions) {
      const d = draftByOrder(job, q.order);
      expect(d.status).toBe('pending');
      expect(d.prompt, `draft ${q.order} keeps the wording`).toBe(q.prompt);
      expect(d.options.map((o) => o.text)).toEqual(q.options);
      expect(d.options.map((o) => o.id)).toEqual(q.options.map((_, i) => String.fromCharCode(97 + i)));
      expect(d.correctOptionIds, `draft ${q.order} answers come from the source only`).toEqual(
        q.correct.map((i) => String.fromCharCode(97 + i)),
      );
      expect(d.explanation, `draft ${q.order} explanation only when the source has one`).toBe(q.explanation);
      if (q.difficulty) expect(d).toMatchObject({ difficulty: q.difficulty, difficultySuggested: true });
      expect(d.flags, `draft ${q.order} flags`).toEqual(QUANT_PAPER_FLAGS[q.order]);
    }
    const stored = await storedDrafts(emulators, ORG_A.id, job.id);
    expect(stored).toHaveLength(9);
    expect(stored.map((d) => d.data.flags)).toEqual(paperQuestions.map((q) => QUANT_PAPER_FLAGS[q.order]));

    // US-AD-06: nothing reaches the test before approval.
    expect(await storedPrompts(emulators, ORG_A.id, testId)).toHaveLength(4);

    // Section headings are detected (reasoning notes, one part).
    await testApi.llm.script({ pages: llmFixture('reasoning-notes').pages });
    const notes = await importReady(admin, request, testApi, testId, reasoningNotes('md'));
    expect(notes.drafts.map((d) => d.sectionName)).toEqual(['Reasoning', 'Reasoning']);
    expect(notes.drafts[0]!.explanation).toBe('Each number is twice the one before it.');
    expect(notes.drafts[1]!.explanation).toBeUndefined();
    expect(notes.drafts.map((d) => d.flags)).toEqual([[], []]);
  });

  test('IMP-01 SEC-06 JSON and template sheets are read directly without the model; other sheets, TXT and MD go to it as text', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(90_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await testApi.llm.script({ pages: llmFixture('free-sheet').pages });
    const admin = await apiAs(accounts.adminA);

    const json = await importReady(admin, request, testApi, testId, questionsJson());
    expect(
      json.drafts.map((d) => ({
        prompt: d.prompt,
        options: d.options.map((o) => o.text),
        correct: correctText(d),
        suggested: d.difficultySuggested ?? false,
      })),
    ).toEqual(
      JSON_QUESTIONS.map((q) => ({
        prompt: q.prompt,
        options: [...q.options],
        correct: q.options[q.correct.charCodeAt(0) - 65],
        suggested: false,
      })),
    );
    expect(json.drafts[0]!.difficulty).toBe('easy');

    for (const f of [templateCsv(), await templateXlsx()]) {
      const sheet = await importReady(admin, request, testApi, testId, f);
      expect(
        sheet.drafts.map((d) => ({
          prompt: d.prompt,
          options: d.options.map((o) => o.text),
          correct: correctText(d),
          difficulty: d.difficulty,
          row: d.sourcePage,
        })),
        `${f.name} read by its template columns`,
      ).toEqual(TEMPLATE_QUESTIONS.map((q, i) => ({ ...q, options: [...q.options], row: i + 2 })));
      expect(sheet.provider).toBeUndefined();
      expect(sheet.tokens).toBeUndefined();
    }
    expect(await testApi.llm.calls(), 'JSON and template sheets never reach the model').toEqual([]);
    expect(await aiImportsUsed(emulators, ORG_A.id)).toBe(0);

    const free = await importReady(admin, request, testApi, testId, freeSheetCsv());
    expect(free.drafts.map((d) => d.prompt)).toEqual(fixtureQuestions(llmFixture('free-sheet')).map((q) => q.prompt));
    expect(free.provider).toBe('mock');
    const txt = await importReady(admin, request, testApi, testId, reasoningNotes('txt'));
    expect(txt.progress).toMatchObject({ pagesDone: 1, pagesTotal: 1 });
    const calls = await testApi.llm.calls();
    expect(calls, 'one call for the sheet, one for the TXT file').toHaveLength(2);
    for (const c of calls) {
      expect(c.parts.some((p) => p.type === 'text')).toBe(true);
      expect(
        c.parts.some((p) => p.type === 'file'),
        'text formats go as text',
      ).toBe(false);
    }
  });

  test('REL-06 a model failure leaves the job waiting to retry from where it stopped, while a running exam carries on', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(90_000);
    const exam = await testApi.seedExamTest({ orgId: ORG_A.id });
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, title: 'Data interpretation' });
    const student = await apiAs(studentOfA(1));
    const attempt = await startAttempt(student, exam.testId);

    await testApi.llm.script({ pages: paper.pages, failures: { '2': 1 } });
    const admin = await apiAs(accounts.adminA);
    const id = await importFile(admin, request, testId, quantPaperPdf());
    const waiting = await waitForJob(admin, testApi, id, ['retrying', 'ready', 'failed']);
    expect(waiting.status).toBe('retrying');
    const now = await testApi.clock.now();
    expect(waiting.progress, 'page 1 is kept').toEqual({ pagesDone: 1, pagesTotal: 3, questionsFound: 2 });
    expect(waiting.error).toEqual({ code: 'LLM_UNAVAILABLE', message: IMPORT_TEXTS.llmUnavailable, retryable: true });
    expect(waiting.retryAt, 'first retry after a minute').toBe(now + MIN);
    const tasks = await importTasks(testApi, id);
    expect(tasks.map((t) => t.scheduleTime)).toEqual([now + MIN]);

    // The exam is unaffected while the import waits.
    const q = attempt.questions[0]!;
    const save = await putAnswers(student, attempt.attempt.id, [
      { questionId: q.id, optionId: q.options[0]!.id, seq: 1, clientTs: now },
    ]);
    expect(save.status).toBe(200);
    expect(save.body.saved).toEqual([q.id]);

    await testApi.clock.advance(MIN);
    const done = await waitForJob(admin, testApi, id, ['ready', 'failed']);
    expect(done.status).toBe('ready');
    expect(done.error).toBeUndefined();
    expect(done.progress).toEqual({ pagesDone: 3, pagesTotal: 3, questionsFound: 9 });
    expect(
      done.drafts.map((d) => d.order),
      'page 1 was not read twice',
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await testApi.llm.calls()).map((c) => c.page)).toEqual([1, 2, 2, 3]);
    expect(await aiImportsUsed(emulators, ORG_A.id), 'a retry does not count again').toBe(1);
  });

  test('REL-06 IMP-08 after four failures in a row the job fails as retryable, and a retry finishes it without counting it twice', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages, failures: { '1': 4 } });
    const admin = await apiAs(accounts.adminA);
    const id = await importFile(admin, request, testId, quantPaperPdf());

    // Retries after 1, 2 and 4 minutes, then the job fails.
    for (const delay of [MIN, 2 * MIN, 4 * MIN]) {
      const now = await testApi.clock.now();
      const waiting = await waitForJobState(
        admin,
        testApi,
        id,
        (j) => j.status === 'retrying' && j.retryAt === now + delay,
        `waits ${delay / MIN} min to retry`,
      );
      expect(waiting.progress.pagesDone).toBe(0);
      await testApi.clock.advance(delay);
    }
    const failed = await waitForJob(admin, testApi, id, ['failed', 'ready']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual({ code: 'LLM_UNAVAILABLE', message: IMPORT_TEXTS.llmGaveUp, retryable: true });
    expect(await importTasks(testApi, id), 'nothing more queued').toHaveLength(0);
    expect((await testApi.llm.calls()).map((c) => c.page)).toEqual([1, 1, 1, 1]);

    const retried = await retryImport(admin, id);
    expect(retried.status, JSON.stringify(retried.body)).toBe(202);
    expect(retried.body.status).toBe('queued');
    const [entry] = await auditFor(emulators, ORG_A.id, 'import.retry', id);
    expect(entry?.data).toMatchObject({ actor: { email: accounts.adminA.email }, target: { type: 'importJob', id } });
    const done = await waitForJob(admin, testApi, id, ['ready', 'failed']);
    expect(done.status).toBe('ready');
    expect(done.drafts).toHaveLength(9);
    expect(await aiImportsUsed(emulators, ORG_A.id), 'counted once').toBe(1);

    const again = await retryImport(admin, id);
    expect(again.status).toBe(409);
    expect((again.body as { error?: { code?: string } }).error?.code).toBe('IMPORT_NOT_RETRYABLE');
    expect((await getJob(admin, id)).status).toBe('ready');
  });

  test('ORG-05 ORG-14 a job, its drafts and its source pages belong to their organization only; a super admin works with them', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: paper.pages });
    const admin = await apiAs(accounts.adminA);
    const job = await importReady(admin, request, testApi, testId, quantPaperPdf());
    const draft1 = draftByOrder(job, 1);

    const adminB = await apiAs(accounts.adminB);
    const student = await apiAs(accounts.studentA);
    const routes: Array<[string, (c: typeof admin) => Promise<{ status: number }>]> = [
      ['GET job', (c) => c.get(`/v1/imports/${job.id}`)],
      ['GET page', (c) => c.get(`/v1/imports/${job.id}/pages/1`)],
      ['PATCH draft', (c) => c.patch(`/v1/imports/${job.id}/drafts/${draft1.id}`, { prompt: 'Changed by org B' })],
      ['approve', (c) => c.post(`/v1/imports/${job.id}/approve`, { draftIds: [draft1.id] })],
      ['discard', (c) => c.post(`/v1/imports/${job.id}/discard`, { draftIds: [draft1.id] })],
      ['retry', (c) => c.post(`/v1/imports/${job.id}/retry`, {})],
    ];
    for (const [name, call] of routes) {
      expect((await call(adminB)).status, `${name} by org B`).toBe(404);
      expect((await call(student)).status, `${name} by a student`).toBe(403);
    }
    const [d1] = await storedDrafts(emulators, ORG_A.id, job.id);
    expect(d1?.data).toMatchObject({ prompt: paperQuestions[0]!.prompt, status: 'pending' });
    expect(await storedPrompts(emulators, ORG_A.id, testId)).toHaveLength(4);

    // ORG-05, ORG-03: a draft cannot be pointed at a file it does not already have, least of all another org's.
    const chart = draftByOrder(job, 5);
    for (const path of [
      `organizations/${ORG_B.id}/tests/x/images/y.png`,
      `organizations/${ORG_A.id}/tests/${testId}/images/other.png`,
    ]) {
      const res = await admin.patch(`/v1/imports/${job.id}/drafts/${chart.id}`, { images: [{ path, alt: 'x' }] });
      expect(res.status, `PATCH images to ${path}: ${JSON.stringify(res.body)}`).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe('VALIDATION');
    }
    const storedChart = (await storedDrafts(emulators, ORG_A.id, job.id))[4]!;
    expect(storedChart.data.images, 'the stored images are unchanged').toEqual(chart.images);

    const superAdmin = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const seen = await getJob(superAdmin, job.id);
    expect(seen.drafts).toHaveLength(9);
    expect((await superAdmin.get(`/v1/imports/${job.id}/pages/1`)).status).toBe(200);
    const edited = await superAdmin.patch<{ prompt: string; flags: unknown[] }>(
      `/v1/imports/${job.id}/drafts/${draftByOrder(job, 4).id}`,
      { correctOptionIds: ['b'] },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.flags, 'checked again: the answer is now set').toEqual([]);
  });
});
