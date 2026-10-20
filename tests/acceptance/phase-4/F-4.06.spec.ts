import { auditFor } from '../fixtures/authoring';
import { expectApiError, expectAttemptSoon, storedAttempt } from '../fixtures/exam';
import {
  expectedTestRow,
  exportReady,
  exportThroughApi,
  fetchSigned,
  freezeClock,
  hasBom,
  NOV_2_0930_IST,
  postExport,
  readCsv,
  readXlsx,
  runLeaderboardTask,
  seriesExportHeaders,
  setFeature,
  sit,
  sitAndSubmit,
  storedExports,
  strike,
  studentFacts,
  submit,
  testExportHeaders,
  XLSX_TYPE,
  type Cell,
} from '../fixtures/results';
import { accounts, ORG_A, studentOfA } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { AdminResultsList, AdminSeriesResults, AdminTestResults } from '../pages/results-pages';
import { NOT_INCLUDED } from '../pages/shell';
import { readFile } from 'node:fs/promises';

// F-4.06 Results exports (US-AD-14; EXP-01 to EXP-03 checked through the real files). Contract:
// docs/testids/phase-4.md, "Export results region", "Files" and "Requests the tests send directly".

const HEADING = 'Day 1: Quantitative aptitude';
const MIN = 60_000;
const facts = (n: number) => studentFacts(ORG_A, n);
/** Cells as the CSV would hold them: numbers as written, empty cells as ''. */
const asText = (rows: Cell[][]) => rows.map((r) => r.map((c) => (c === null ? '' : String(c))));

test.describe('F-4.06 results exports', () => {
  test('US-AD-14 EXP-01 EXP-03 the admin exports a test as CSV from its results page, and the file holds every column for every attempt', async ({
    page,
    request,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id, questions: 'sectioned', overrides: { maxStrikes: 2 } });
    await signInAs(accounts.adminA);
    const a = await apiAs(accounts.studentA);
    const b = await apiAs(studentOfA(2));
    const c = await apiAs(studentOfA(3));
    const pa = await sit(a, testApi, t.testId, { 0: 'Option one', 1: 'Option two', 6: 'Option one' });
    const pb = await sit(b, testApi, t.testId, { 0: 'Option one' });
    const pc = await sit(c, testApi, t.testId, { 0: 'Option one', 1: 'Option one', 2: 'Option one' });
    expect(await strike(b, testApi, pb.attempt.id, 2)).toBe('terminated');
    await testApi.clock.advance(10 * MIN);
    await submit(a, pa.attempt.id);
    await testApi.clock.set(pc.attempt.deadlineAt + 121_000);
    await testApi.tasks.runDue();
    await expectAttemptSoon(emulators, ORG_A.id, pc.attempt.id, (x) => x.status === 'auto_submitted', 'auto-submitted');
    await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });

    const results = new AdminTestResults(page);
    await results.goto(t.testId, HEADING);
    await results.exports.csv.click();
    await expect(results.exports.status).toHaveText('Your export is ready.', { timeout: 30_000 });
    const link = results.exports.download('CSV');
    await expect(link).toBeVisible();
    await expect(results.exports.note).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href, 'signed link').toBeTruthy();
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toBe(`results-${t.testId}.csv`);
    const file = await readFile((await download.path())!);

    expect(hasBom(file), 'UTF-8 with a byte order mark').toBe(true);
    const rows = readCsv(file);
    expect(rows[0]).toEqual(testExportHeaders(['Quant', 'Verbal']));
    const sections = [t.sectionIds.Quant!, t.sectionIds.Verbal!];
    const sa = await storedAttempt(emulators, ORG_A.id, pa.attempt.id);
    const sb = await storedAttempt(emulators, ORG_A.id, pb.attempt.id);
    const sc = await storedAttempt(emulators, ORG_A.id, pc.attempt.id);
    expect(rows.slice(1)).toEqual([
      expectedTestRow(facts(3), sc, '1', sections),
      expectedTestRow(facts(1), sa, '2', sections),
      expectedTestRow(facts(2), sb, '', sections),
    ]);
    // Spot checks against the spec's own words, independent of the helper.
    expect(rows[1]!.slice(5, 10)).toEqual(['Submitted automatically', '3', '10', '30', '1']);
    expect(rows[2]!.slice(5, 12)).toEqual(['Submitted', '2', '10', '20', '2', '1', '1']);
    expect(rows[3]![5]).toBe('Ended after strikes');
    expect(rows[3]![9], 'terminated attempts have no rank').toBe('');
    expect(rows[3]!.slice(-3)).toEqual(['2', 'Maximum strikes reached', '0']);
    // Student 01 started with the others, waited out the 4 seconds of the strikes, then 10 minutes.
    expect(rows[2]![rows[0]!.indexOf('Time taken (seconds)')]).toBe('604');

    const exportsStored = await storedExports(emulators, ORG_A.id);
    expect(exportsStored).toHaveLength(1);
    expect(exportsStored[0]!.data).toMatchObject({
      orgId: ORG_A.id,
      scope: 'test',
      refId: t.testId,
      format: 'csv',
      status: 'ready',
    });
    expect(typeof exportsStored[0]!.data.filePath).toBe('string');
    const audit = await auditFor(emulators, ORG_A.id, 'results.export', t.testId);
    expect(audit, 'results.export audit entry').toHaveLength(1);
    expect(audit[0]!.data.target).toMatchObject({ type: 'test', id: t.testId });
    expect(audit[0]!.data.after).toMatchObject({ format: 'csv', exportId: exportsStored[0]!.id });
    expect(audit[0]!.data.actor).toMatchObject({ email: accounts.adminA.email, role: 'admin' });

    const fresh = await fetchSigned(request, href!);
    expect(fresh.status).toBe(200);
    expect(fresh.headers['content-disposition']).toContain(`results-${t.testId}.csv`);
    expect(fresh.headers['content-disposition']).toMatch(/^attachment/);
    expect(fresh.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/i);
    await testApi.clock.advance(15 * MIN + 1_000);
    const stale = await fetchSigned(request, href!);
    expect(stale.status, 'the link expires after 15 minutes').toBeGreaterThanOrEqual(400);
    expect(stale.status).toBeLessThan(500);
    expect(stale.body.toString('utf8')).not.toContain('Name,Email,PRN');
  });

  test('US-AD-14 EXP-01 API-02 the test XLSX holds one Results sheet with the same columns and numbers as numeric cells', async ({
    request,
    apiAs,
    testApi,
    emulators,
  }) => {
    await freezeClock(testApi);
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    const a = await sitAndSubmit(await apiAs(accounts.studentA), testApi, t.testId, { 0: '20 m/s', 1: '30' }, 5);
    const b = await sitAndSubmit(await apiAs(studentOfA(2)), testApi, t.testId, { 0: '20 m/s', 1: '30', 2: '4' });
    await runLeaderboardTask(request, { orgId: ORG_A.id, testId: t.testId, seriesId: t.seriesId });
    const admin = await apiAs(accounts.adminA);

    const first = await postExport(admin, { scope: 'test', refId: t.testId, format: 'xlsx' }, 'xlsx-once');
    expect([200, 201, 202], JSON.stringify(first.body)).toContain(first.status);
    const replay = await postExport(admin, { scope: 'test', refId: t.testId, format: 'xlsx' }, 'xlsx-once');
    expect(replay.body.id, 'a repeated Idempotency-Key replays the same export').toBe(first.body.id);
    const ready = await exportReady(admin, testApi, first.body.id);
    expect(ready).toMatchObject({
      scope: 'test',
      refId: t.testId,
      format: 'xlsx',
      filename: `results-${t.testId}.xlsx`,
    });
    expect(ready.expiresAt, 'link valid for 15 minutes on the server clock').toBe(
      (await testApi.clock.now()) + 15 * MIN,
    );

    const file = await fetchSigned(request, ready.url!);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain(XLSX_TYPE);
    expect(file.headers['content-disposition']).toContain(`results-${t.testId}.xlsx`);
    const sheets = await readXlsx(file.body);
    expect(sheets.map((s) => s.name)).toEqual(['Results']);
    const rows = sheets[0]!.rows;
    expect(rows[0]).toEqual(testExportHeaders([]));
    const sa = await storedAttempt(emulators, ORG_A.id, a);
    const sb = await storedAttempt(emulators, ORG_A.id, b);
    expect(asText(rows.slice(1))).toEqual([expectedTestRow(facts(2), sb, '1'), expectedTestRow(facts(1), sa, '2')]);
    const header = rows[0] as string[];
    for (const col of ['Graduation year', 'Score', 'Maximum', 'Percentage', 'Rank', 'Correct', 'Time taken (seconds)'])
      expect(typeof rows[1]![header.indexOf(col)], `${col} is a numeric cell`).toBe('number');
    for (const col of ['Name', 'Email', 'PRN', 'Status', 'Started at (IST)'])
      expect(typeof rows[1]![header.indexOf(col)], `${col} is a text cell`).toBe('string');
  });

  test('US-AD-14 EXP-02 the series export has one row per student with a score per test, the total and the rank, and the XLSX adds a sheet per test', async ({
    page,
    request,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    test.setTimeout(120_000);
    await testApi.clock.set(NOV_2_0930_IST);
    const { seriesId } = await testApi.seedSeries({
      orgId: ORG_A.id,
      status: 'active',
      defaults: { resultRelease: 'immediate' },
    });
    const quant = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, opensInMin: -1440 });
    const verbal = await testApi.seedExamTest({ orgId: ORG_A.id, seriesId, title: 'Verbal ability' });
    const quantIds = await testApi.seedGradedAttempts(ORG_A.id, quant.testId, [
      { studentId: facts(1).id, score: 3, timeSec: 600, correct: 3, incorrect: 1 },
      { studentId: facts(2).id, score: 4, timeSec: 600, correct: 4 },
      { studentId: facts(3).id, score: 2, timeSec: 300, status: 'terminated', strikesCount: 3 },
    ]);
    await testApi.seedGradedAttempts(ORG_A.id, verbal.testId, [
      { studentId: facts(1).id, score: 2, timeSec: 600 },
      { studentId: facts(4).id, score: 1, timeSec: 600 },
    ]);
    for (const testId of [quant.testId, verbal.testId])
      await runLeaderboardTask(request, { orgId: ORG_A.id, testId, seriesId });

    await signInAs(accounts.adminA);
    const list = new AdminResultsList(page);
    await list.goto();
    await list.seriesLink('Placement 2026').click();
    const seriesPage = new AdminSeriesResults(page);
    await expect(seriesPage.heading('Placement 2026')).toBeVisible();
    await seriesPage.exports.xlsx.click();
    await expect(seriesPage.exports.status).toHaveText('Your export is ready.', { timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), seriesPage.exports.download('XLSX').click()]);
    expect(download.suggestedFilename()).toBe(`series-results-${seriesId}.xlsx`);
    const sheets = await readXlsx(await readFile((await download.path())!));
    expect(sheets.map((s) => s.name)).toEqual(['Series', 'Day 1 Quantitative aptitude', 'Day 2 Verbal ability']);

    const person = (n: number) => [
      facts(n).name,
      facts(n).email,
      facts(n).prn,
      facts(n).department,
      String(facts(n).graduationYear),
    ];
    const seriesRows = [
      seriesExportHeaders([HEADING, 'Day 2: Verbal ability']),
      [...person(1), '3', '2', '5', '1'],
      [...person(2), '4', '', '4', '2'],
      [...person(4), '', '1', '1', '3'],
      [...person(3), '', '', '0', ''], // only a terminated attempt: nothing counted, no rank
    ];
    expect(asText(sheets[0]!.rows)).toEqual(seriesRows);
    const day1 = sheets[1]!.rows;
    expect(day1[0]).toEqual(testExportHeaders([]));
    const stored = await Promise.all(quantIds.map((attemptId) => storedAttempt(emulators, ORG_A.id, attemptId)));
    expect(asText(day1.slice(1))).toEqual([
      expectedTestRow(facts(2), stored[1]!, '1'),
      expectedTestRow(facts(1), stored[0]!, '2'),
      expectedTestRow(facts(3), stored[2]!, ''),
    ]);
    expect(sheets[2]!.rows.slice(1).map((r) => r[0])).toEqual([facts(1).name, facts(4).name]);

    const admin = await apiAs(accounts.adminA);
    const csv = await exportThroughApi(admin, testApi, { scope: 'series', refId: seriesId, format: 'csv' });
    expect(csv.filename).toBe(`series-results-${seriesId}.csv`);
    const file = await fetchSigned(request, csv.url!);
    expect(file.status).toBe(200);
    expect(hasBom(file.body)).toBe(true);
    expect(readCsv(file.body)).toEqual(seriesRows);

    const audit = await auditFor(emulators, ORG_A.id, 'results.export', seriesId);
    expect(audit.map((e) => (e.data.after as { format?: string }).format).sort()).toEqual(['csv', 'xlsx']);
    for (const e of audit) expect(e.data.target).toMatchObject({ type: 'series', id: seriesId });
  });

  test('FF-02 FF-03 API-02 ORG-05 ORG-14 exports need an Idempotency-Key, are 404 for org B and 403 for students, work for a super admin, and lock when Results export is off', async ({
    page,
    signInAs,
    apiAs,
    testApi,
    emulators,
  }) => {
    const t = await testApi.seedExamTest({ orgId: ORG_A.id });
    await testApi.seedGradedAttempts(ORG_A.id, t.testId, [{ studentId: facts(1).id, score: 3, timeSec: 600 }]);
    await signInAs(accounts.adminA);
    const admin = await apiAs(accounts.adminA);
    const body = { scope: 'test' as const, refId: t.testId, format: 'csv' as const };

    expectApiError(await admin.post('/v1/exports', body), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expectApiError(await postExport(admin, { ...body, refId: 'no-such-test' }), 404);
    expectApiError(await postExport(admin, { scope: 'series', refId: 'no-such-series', format: 'csv' }), 404);
    const adminB = await apiAs(accounts.adminB);
    expectApiError(await postExport(adminB, body), 404);
    expectApiError(await postExport(adminB, { scope: 'series', refId: t.seriesId, format: 'xlsx' }), 404);
    expectApiError(await postExport(await apiAs(accounts.studentA), body), 403);
    expect(await storedExports(emulators, ORG_A.id), 'nothing stored by refusals').toEqual([]);

    const superAdmin = await apiAs(accounts.superAdmin);
    const made = await exportThroughApi(superAdmin.inOrg(ORG_A.id), testApi, body);
    expectApiError(await adminB.get(`/v1/exports/${made.id}`), 404);
    const audit = await auditFor(emulators, ORG_A.id, 'results.export', t.testId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data.actor).toMatchObject({ email: accounts.superAdmin.email, role: 'superAdmin' });

    await setFeature(superAdmin, ORG_A.id, 'results_export', false);
    expectApiError(await postExport(admin, body), 403, 'FEATURE_DISABLED');
    const results = new AdminTestResults(page);
    await results.goto(t.testId, HEADING);
    for (const control of [results.exports.csv, results.exports.xlsx]) {
      await expect(control).toBeDisabled();
      await expect(control).toHaveAccessibleDescription(NOT_INCLUDED);
    }
    expect(await storedExports(emulators, ORG_A.id)).toHaveLength(1);
  });
});
