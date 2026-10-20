import { AUTHORING_NOW, SEEDED_TEST, auditFor } from '../fixtures/authoring';
import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import { expectApiError } from '../fixtures/exam';
import {
  docxFile,
  exeNamed,
  freeSheetCsv,
  llmFixture,
  MAX_IMPORT_BYTES,
  oversizePdf,
  plainPdf,
  pngNamed,
  PDF_TYPE,
  questionsJson,
  quantPaperPdf,
  reasoningNotes,
  templateCsv,
  templateCsvWithRows,
  templateXlsx,
  XLSX_TYPE,
  file,
} from '../fixtures/import-files';
import {
  aiImportsUsed,
  errorOf,
  getJob,
  IMPORT_TEXTS,
  importFile,
  importReady,
  importTasks,
  postImport,
  setAiImportLimit,
  startImport,
  storageBytes,
  storageObject,
  storedJob,
  storedJobs,
  uploadRefused,
  uploadTo,
  waitForJob,
} from '../fixtures/imports';
import { setFeature } from '../fixtures/results';
import { accounts, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { QuestionsTabImports } from '../pages/import-pages';
import { TestEditorPage } from '../pages/test-editor';
import { expectFieldError } from '../pages/ui';

// F-6.02 Import upload and job API (IMP-01, IMP-02, IMP-08, SEC-06). Contract: docs/testids/phase-6.md,
// "Formats and limits", "Requests the tests send directly", "Worker pipeline" step 2 and "Upload dialog".

const reasoning = llmFixture('reasoning-notes');

test.beforeEach(async ({ testApi }) => {
  await testApi.clock.set(AUTHORING_NOW);
});

test.describe('F-6.02 import upload and job API', () => {
  test('IMP-01 SEC-06 each accepted format gets a signed upload and a job; the file is kept with the job and the worker reads it', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    // Page or part 1 of every file the model reads holds the two reasoning questions.
    await testApi.llm.script({ pages: reasoning.pages });
    const admin = await apiAs(accounts.adminA);
    const uid = (await emulators.authAccount(accounts.adminA.email)).localId;

    const files = [
      { f: questionsJson(), format: 'json' },
      { f: quantPaperPdf(), format: 'pdf' },
      { f: await templateXlsx(), format: 'xlsx' },
      { f: templateCsv(), format: 'csv' },
      { f: reasoningNotes('txt'), format: 'txt' },
      { f: reasoningNotes('md'), format: 'md' },
    ];
    const ids: string[] = [];
    for (const { f, format } of files) {
      await testApi.clock.advance(1000);
      const now = await testApi.clock.now();
      const created = await postImport(admin, testId, f);
      expect(created.status, `POST /v1/imports ${f.name}: ${JSON.stringify(created.body)}`).toBe(201);
      expect(created.body.status).toBe('awaiting_upload');
      expect(created.body.uploadUrl, 'a signed upload link').toMatch(/^https?:\/\/\S+$/);
      expect(created.body.uploadExpiresAt, 'the link works for 15 minutes').toBe(now + 900_000);
      const id = created.body.id;
      ids.push(id);

      const stored = await storedJob(emulators, ORG_A.id, id);
      expect(stored).toMatchObject({
        orgId: ORG_A.id,
        testId,
        filename: f.name,
        format,
        contentType: f.contentType,
        sizeBytes: f.bytes.length,
        status: 'awaiting_upload',
        filePath: `organizations/${ORG_A.id}/imports/${id}/source.${format}`,
        createdBy: uid,
      });

      expect(await uploadTo(request, created.body.uploadUrl, f), `upload of ${f.name}`).toBe(200);
      // Q31: the source file is kept with its job, byte for byte.
      const kept = await storageBytes(request, String(stored.filePath));
      expect(kept?.equals(f.bytes), `${f.name} stored at the job's filePath`).toBe(true);

      const started = await startImport(admin, id);
      expect(started.status, `start ${f.name}: ${JSON.stringify(started.body)}`).toBe(202);
      expect(started.body.status).toBe('queued');
      // Starting again queues nothing new.
      const again = await startImport(admin, id);
      expect(again.status).toBe(202);
      expect((await importTasks(testApi, id)).length).toBeLessThanOrEqual(1);
    }

    for (const [i, id] of ids.entries()) {
      const job = await waitForJob(admin, testApi, id, ['ready', 'failed']);
      expect(job.error, `${files[i]!.f.name}: ${JSON.stringify(job.error)}`).toBeUndefined();
      expect(job.status).toBe('ready');
      expect(job.drafts, `${files[i]!.f.name} becomes two drafts`).toHaveLength(2);
      expect(job.progress.questionsFound).toBe(2);
    }

    const listed = await admin.get<{ items: Array<{ id: string; filename: string; format: string; status: string }> }>(
      `/v1/imports?testId=${testId}`,
    );
    expect(listed.status).toBe(200);
    expect(
      listed.body.items.map((j) => j.id),
      'newest first',
    ).toEqual([...ids].reverse());

    const audit = await emulators.audit(ORG_A.id, 'import.create');
    expect(audit).toHaveLength(6);
    for (const [i, id] of ids.entries()) {
      const entry = audit.find((a) => (a.data.target as { id?: string }).id === id);
      expect(entry?.data, `import.create for ${files[i]!.f.name}`).toMatchObject({
        actor: { uid, role: 'admin', email: accounts.adminA.email },
        target: { type: 'importJob', id },
        after: { testId, filename: files[i]!.f.name, format: files[i]!.format },
      });
    }
  });

  test('IMP-01 SEC-06 other formats, and files whose bytes are not what their name says, are refused before any parsing', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await testApi.llm.script({ pages: reasoning.pages });
    const admin = await apiAs(accounts.adminA);

    for (const f of [
      docxFile(),
      pngNamed('diagram.png', 'image/png'),
      file('README', 'text/plain', 'What is 2 + 2?\n'),
    ]) {
      const res = await postImport(admin, testId, f);
      expectApiError(res, 400, 'UNSUPPORTED_FORMAT');
      expect(errorOf(res).message).toBe(IMPORT_TEXTS.unsupported);
    }
    expect(await storedJobs(emulators, ORG_A.id), 'nothing stored for a refused format').toHaveLength(0);

    const fakes = [
      { f: pngNamed('paper.pdf', PDF_TYPE), format: 'PDF' },
      { f: pngNamed('questions.csv', 'text/csv'), format: 'CSV' },
      { f: exeNamed('sheet.xlsx', XLSX_TYPE), format: 'XLSX' },
      { f: exeNamed('notes.txt', 'text/plain'), format: 'TXT' },
    ];
    for (const { f, format } of fakes) {
      const created = await postImport(admin, testId, f);
      expect(created.status, `the name ${f.name} is accepted at first`).toBe(201);
      expect(await uploadTo(request, created.body.uploadUrl, f)).toBe(200);
      const started = await startImport(admin, created.body.id);
      expectApiError(started, 400, 'FILE_SIGNATURE_MISMATCH');
      expect(errorOf(started).message).toBe(IMPORT_TEXTS.mismatch(format));
      const stored = await storedJob(emulators, ORG_A.id, created.body.id);
      expect(stored).toMatchObject({
        status: 'failed',
        error: { code: 'FILE_SIGNATURE_MISMATCH', message: IMPORT_TEXTS.mismatch(format), retryable: false },
      });
      expect(await importTasks(testApi, created.body.id), `no task queued for ${f.name}`).toHaveLength(0);
      const view = await getJob(admin, created.body.id);
      expect(view.status).toBe('failed');
      expect(view.drafts).toEqual([]);
    }
    expect(await testApi.llm.calls(), 'the model never saw a refused file').toEqual([]);
    expect(await aiImportsUsed(emulators, ORG_A.id)).toBe(0);

    // Starting before anything was uploaded.
    const early = await postImport(admin, testId, questionsJson());
    expect(early.status).toBe(201);
    expectApiError(await startImport(admin, early.body.id), 409, 'UPLOAD_MISSING');
    expect((await storedJob(emulators, ORG_A.id, early.body.id)).status).toBe('awaiting_upload');

    // Once started, the link takes nothing more: the stored file stays the one that was checked.
    const json = questionsJson('checked.json');
    const checked = await postImport(admin, testId, json);
    expect(checked.status).toBe(201);
    expect(await uploadTo(request, checked.body.uploadUrl, json)).toBe(200);
    expect((await startImport(admin, checked.body.id)).status).toBe(202);
    const swapped = await uploadTo(request, checked.body.uploadUrl, pngNamed('checked.json', 'application/json'));
    expect(uploadRefused(swapped), `PUT after start answered ${swapped}`).toBe(true);
    const checkedPath = String((await storedJob(emulators, ORG_A.id, checked.body.id)).filePath);
    expect((await storageBytes(request, checkedPath))?.equals(json.bytes), 'the stored file is unchanged').toBe(true);

    // The link expires 15 minutes after the job was created, on the server clock.
    const late = await postImport(admin, testId, questionsJson('late.json'));
    expect(late.status).toBe(201);
    await testApi.clock.advance(900_001);
    const expired = await uploadTo(request, late.body.uploadUrl, questionsJson('late.json'));
    expect(expired >= 400 && expired < 500, `PUT after expiry answered ${expired}`).toBe(true);
    const latePath = String((await storedJob(emulators, ORG_A.id, late.body.id)).filePath);
    expect(await storageObject(request, latePath), 'nothing stored after expiry').toBeNull();
    expectApiError(await startImport(admin, late.body.id), 409, 'UPLOAD_MISSING');
  });

  test('IMP-02 files over 25 MB, PDFs over 100 pages and sheets over 5,000 rows are refused with the limit stated', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await testApi.llm.script({ pages: reasoning.pages });
    const admin = await apiAs(accounts.adminA);

    const declared = await postImport(admin, testId, quantPaperPdf(), { sizeBytes: MAX_IMPORT_BYTES + 1 });
    expectApiError(declared, 400, 'FILE_TOO_LARGE');
    expect(errorOf(declared).message).toBe(IMPORT_TEXTS.tooLarge);
    expect(await storedJobs(emulators, ORG_A.id)).toHaveLength(0);

    // A body over the limit is refused by the upload link itself, whatever size was declared.
    const big = oversizePdf();
    const created = await postImport(admin, testId, big, { sizeBytes: 1000 });
    expect(created.status).toBe(201);
    const put = await uploadTo(request, created.body.uploadUrl, big);
    expect(uploadRefused(put), `upload over 25 MB answered ${put}`).toBe(true);
    const job = await storedJob(emulators, ORG_A.id, created.body.id);
    expect(await storageObject(request, String(job.filePath)), 'nothing stored').toBeNull();
    expectApiError(await startImport(admin, created.body.id), 409, 'UPLOAD_MISSING');

    // 101 pages: refused by the worker before any model call, and not counted.
    const pages = await importFile(admin, request, testId, {
      name: 'long-paper.pdf',
      contentType: PDF_TYPE,
      bytes: plainPdf(101),
    });
    const tooLong = await waitForJob(admin, testApi, pages, ['ready', 'failed']);
    expect(tooLong.status).toBe('failed');
    expect(tooLong.error).toEqual({
      code: 'TOO_MANY_PAGES',
      message: IMPORT_TEXTS.tooManyPages('101'),
      retryable: false,
    });
    expect(tooLong.drafts).toEqual([]);
    expect(await testApi.llm.calls()).toEqual([]);
    expect(await aiImportsUsed(emulators, ORG_A.id)).toBe(0);

    // 5,001 rows after the header.
    const rows = await importFile(admin, request, testId, templateCsvWithRows(5001));
    const tooMany = await waitForJob(admin, testApi, rows, ['ready', 'failed']);
    expect(tooMany.status).toBe('failed');
    expect(tooMany.error).toEqual({
      code: 'TOO_MANY_ROWS',
      message: IMPORT_TEXTS.tooManyRows('5,001'),
      retryable: false,
    });
    expect(tooMany.drafts).toEqual([]);
    expect(await emulators.count(`organizations/${ORG_A.id}/importJobs/${rows}`, 'drafts')).toBe(0);
  });

  test('IMP-08 AI imports count against ai_imports_per_month; JSON and template sheets do not', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    await testApi.llm.script({ pages: reasoning.pages });
    const superAdmin = await apiAs(accounts.superAdmin);
    await setAiImportLimit(superAdmin, ORG_A.id, 2);
    const admin = await apiAs(accounts.adminA);

    await importReady(admin, request, testApi, testId, reasoningNotes('txt'));
    expect(await aiImportsUsed(emulators, ORG_A.id), 'a TXT import counts').toBe(1);
    await importReady(admin, request, testApi, testId, questionsJson());
    await importReady(admin, request, testApi, testId, templateCsv());
    await importReady(admin, request, testApi, testId, await templateXlsx());
    expect(await aiImportsUsed(emulators, ORG_A.id), 'JSON and template sheets do not count').toBe(1);
    const free = await importReady(admin, request, testApi, testId, freeSheetCsv());
    expect(free.provider, 'a sheet outside the template goes to the model').toBe('mock');
    expect(await aiImportsUsed(emulators, ORG_A.id), 'a sheet the model reads counts').toBe(2);
    expect(await storedJob(emulators, ORG_A.id, free.id)).toMatchObject({ aiCounted: true });

    // The limit is reached: the AI formats are refused up front, and nothing is stored for them.
    const before = (await storedJobs(emulators, ORG_A.id)).length;
    for (const f of [quantPaperPdf(), reasoningNotes('md')]) {
      const res = await postImport(admin, testId, f);
      expectApiError(res, 409, 'LIMIT_REACHED');
      expect(errorOf(res).details).toMatchObject({
        limit: 'ai_imports_per_month',
        max: 2,
      });
    }
    expect(await storedJobs(emulators, ORG_A.id)).toHaveLength(before);
    // JSON still imports.
    await importReady(admin, request, testApi, testId, questionsJson('more.json'));
    // A sheet outside the template is only known in the worker, which fails it at the limit.
    const late = await importFile(admin, request, testId, freeSheetCsv('late-sheet.csv'));
    const refused = await waitForJob(admin, testApi, late, ['ready', 'failed']);
    expect(refused.status).toBe('failed');
    expect(refused.error).toMatchObject({ code: 'LIMIT_REACHED', retryable: false });
    expect(await aiImportsUsed(emulators, ORG_A.id), 'still 2').toBe(2);

    // FF-02: with AI import off, the AI formats are refused but JSON is not.
    await setFeature(superAdmin, ORG_A.id, 'ai_question_import', false);
    expectApiError(await postImport(admin, testId, quantPaperPdf()), 403, 'FEATURE_DISABLED');
    expect((await postImport(admin, testId, questionsJson('off.json'))).status).toBe(201);
  });

  test('ORG-05 ORG-14 API-02 students and org B get no import, a super admin imports in org A, and a repeated key replays the job', async ({
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id, questions: 'none' });
    const admin = await apiAs(accounts.adminA);
    const adminB = await apiAs(accounts.adminB);
    const student = await apiAs(accounts.studentA);

    expect((await postImport(student, testId, questionsJson())).status).toBe(403);
    expect((await postImport(adminB, testId, questionsJson())).status, 'org B cannot import into an org A test').toBe(
      404,
    );
    expectApiError(await postImport(admin, testId, questionsJson(), { noKey: true }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expect(await storedJobs(emulators, ORG_A.id)).toHaveLength(0);

    const key = 'import-key-1';
    const first = await postImport(admin, testId, questionsJson(), { key });
    const second = await postImport(admin, testId, questionsJson(), { key });
    expect(first.status).toBe(201);
    expect(second.body.id, 'the same key replays the same job').toBe(first.body.id);
    expect(await storedJobs(emulators, ORG_A.id)).toHaveLength(1);
    const jobId = first.body.id;

    expect((await adminB.get(`/v1/imports/${jobId}`)).status).toBe(404);
    expect((await adminB.post(`/v1/imports/${jobId}/start`, {})).status).toBe(404);
    expect((await adminB.get(`/v1/imports?testId=${testId}`)).status).toBe(404);
    expect((await student.get(`/v1/imports/${jobId}`)).status).toBe(403);
    expect((await storedJob(emulators, ORG_A.id, jobId)).status, 'org B changed nothing').toBe('awaiting_upload');

    const superAdmin = (await apiAs(accounts.superAdmin)).inOrg(ORG_A.id);
    const job = await importReady(superAdmin, request, testApi, testId, questionsJson('super.json'));
    expect(job.drafts).toHaveLength(2);
    const superUid = (await emulators.authAccount(accounts.superAdmin.email)).localId;
    expect(await storedJob(emulators, ORG_A.id, job.id)).toMatchObject({ createdBy: superUid, orgId: ORG_A.id });
    const [entry] = await auditFor(emulators, ORG_A.id, 'import.create', job.id);
    expect(entry?.data).toMatchObject({ actor: { uid: superUid, role: 'superAdmin' } });
    expect(await storedJobs(emulators, ORG_B.id), 'nothing in org B').toHaveLength(0);
  });

  test('IMP-01 IMP-02 IMP-08 SEC-06 the upload dialog states the formats and limits and refuses a DOCX, an over-size file, a fake PDF and an AI import past the limit', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
    request,
  }) => {
    test.setTimeout(120_000);
    const { testId } = await testApi.seedAuthoringTest({ orgId: ORG_A.id });
    await testApi.llm.script({ pages: reasoning.pages });
    await signInAs(accounts.adminA);
    const editor = new TestEditorPage(page);
    await editor.goto(testId, SEEDED_TEST.heading);
    const tab = new QuestionsTabImports(page, await editor.openTab('Questions'));
    const dlg = await tab.openImport();
    await expect(dlg.formats).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await dlg.submit.click();
    await expectFieldError(dlg.dialog, dlg.file, IMPORT_TEXTS.noFile);
    await dlg.startWith(docxFile());
    await expectFieldError(dlg.dialog, dlg.file, IMPORT_TEXTS.unsupported);
    await dlg.startWith(oversizePdf());
    await expectFieldError(dlg.dialog, dlg.file, IMPORT_TEXTS.tooLarge);
    expect(await storedJobs(emulators, ORG_A.id), 'the browser refused them before asking the API').toHaveLength(0);

    await dlg.startWith(pngNamed('paper.pdf', PDF_TYPE));
    await expectFieldError(dlg.dialog, dlg.file, IMPORT_TEXTS.mismatch('PDF'));
    await expect(dlg.dialog).toBeVisible();

    // Use up the month's single AI import, then try a PDF.
    const superAdmin = await apiAs(accounts.superAdmin);
    await setAiImportLimit(superAdmin, ORG_A.id, 1);
    const admin = await apiAs(accounts.adminA);
    await importReady(admin, request, testApi, testId, reasoningNotes('txt'));
    const jobsBefore = (await storedJobs(emulators, ORG_A.id)).length;
    await dlg.startWith(quantPaperPdf());
    await expect(dlg.alert).toHaveText(IMPORT_TEXTS.limitReached(1));
    await expect(dlg.dialog).toBeVisible();
    expect(await storedJobs(emulators, ORG_A.id)).toHaveLength(jobsBefore);
    expect(await aiImportsUsed(emulators, ORG_A.id)).toBe(1);
  });
});
