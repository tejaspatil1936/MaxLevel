import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const MONTH = '2026-10';

beforeEach(async () => {
  await clearEmulators();
});

const report = (id: string, createdAt: number) => ({
  id,
  scope: 'test' as const,
  refId: 't1',
  title: 'Day 1: Quantitative aptitude',
  includeXlsx: false,
  createdBy: 'uid-1',
  createdByName: 'Admin 1',
  createdAt,
});
const used = async (orgId = 'org-a') =>
  ((await db.doc(`organizations/${orgId}/usage/${MONTH}`).get()).get('aiReports') as number | undefined) ?? 0;

describe('reports data access', () => {
  it('EXP-06 EXP-07 ORG-03 stores a queued report with its count and audit write in one transaction', async () => {
    const id = data.reports.newReportId('org-a');
    let audited = 0;
    const result = await data.reports.createReport('org-a', report(id, 5), { month: MONTH, limit: 2 }, () => {
      audited++;
    });
    expect(result).toBe('created');
    expect(audited).toBeGreaterThanOrEqual(1);
    expect(await data.reports.getReport('org-a', id)).toEqual({ ...report(id, 5), orgId: 'org-a', status: 'queued' });
    expect(await data.reports.getReport('org-b', id), 'another organization never sees it').toBeNull();
    expect(await used()).toBe(1);
    expect((await db.doc(`organizations/org-a/usage/${MONTH}`).get()).data()).toMatchObject({
      orgId: 'org-a',
      month: MONTH,
    });
  });

  it('EXP-07 two requests at the limit minus one, started together, store exactly one report', async () => {
    await db.doc(`organizations/org-a/usage/${MONTH}`).set({ orgId: 'org-a', month: MONTH, aiReports: 4 });
    const ids = [data.reports.newReportId('org-a'), data.reports.newReportId('org-a')];
    const results = await Promise.all(
      ids.map((id) => data.reports.createReport('org-a', report(id, 1), { month: MONTH, limit: 5 }, () => undefined)),
    );
    expect([...results].sort()).toEqual(['created', 'limit']);
    expect(await used()).toBe(5);
    expect(await data.reports.listReports('org-a')).toHaveLength(1);
  });

  it('EXP-06 lists every report newest first, then by ID, and finds finished attempts by test', async () => {
    for (const [id, at] of [
      ['r-a', 10],
      ['r-c', 30],
      ['r-b', 30],
    ] as const)
      await data.reports.createReport('org-a', report(id, at), { month: MONTH, limit: 10 }, () => undefined);
    expect((await data.reports.listReports('org-a')).map((r) => r.id)).toEqual(['r-c', 'r-b', 'r-a']);
    expect(await data.reports.listReports('org-b')).toEqual([]);

    const attempts = db.collection('organizations/org-a/attempts');
    await attempts.doc('a1').set({ orgId: 'org-a', testId: 't1', status: 'in_progress' });
    await attempts.doc('a2').set({ orgId: 'org-a', testId: 't2', status: 'reset' });
    expect(await data.reports.hasFinishedAttempt('org-a', ['t1', 't2'])).toBe(false);
    await attempts.doc('a3').set({ orgId: 'org-a', testId: 't2', status: 'terminated' });
    expect(await data.reports.hasFinishedAttempt('org-a', ['t1', 't2'])).toBe(true);
    expect(await data.reports.hasFinishedAttempt('org-b', ['t2']), 'only in its own organization').toBe(false);
    expect(await data.reports.hasFinishedAttempt('org-a', [])).toBe(false);
  });
});
