import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);

beforeEach(async () => {
  await clearEmulators();
});

const job = (id: string, createdAt: number, testId = 't1') => ({
  id,
  testId,
  filename: 'paper.pdf',
  format: 'pdf' as const,
  contentType: 'application/pdf',
  sizeBytes: 10,
  filePath: `organizations/org-a/imports/${id}/source.pdf`,
  status: 'awaiting_upload' as const,
  progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
  createdBy: 'uid-1',
  createdAt,
});

describe('import jobs data access', () => {
  it("IMP-01 ORG-03 stores a job in a batch under its organization and lists a test's jobs newest first", async () => {
    const batch = db.batch();
    for (const [id, at] of [
      ['j1', 1],
      ['j2', 3],
      ['j3', 2],
    ] as const)
      data.imports.addImport('org-a', batch, job(id, at));
    data.imports.addImport('org-a', batch, job('j4', 9, 't2'));
    expect(await data.imports.getImport('org-a', 'j1'), 'nothing before the commit').toBeNull();
    await batch.commit();
    expect(await data.imports.getImport('org-a', 'j1')).toEqual({ ...job('j1', 1), orgId: 'org-a' });
    expect(await data.imports.getImport('org-b', 'j1')).toBeNull();
    expect((await data.imports.listImports('org-a', 't1')).map((j) => j.id)).toEqual(['j2', 'j3', 'j1']);
    expect(await data.imports.listImports('org-b', 't1')).toEqual([]);
  });

  it('IMP-01 a job leaves awaiting_upload once: a repeated start changes nothing', async () => {
    const batch = db.batch();
    data.imports.addImport('org-a', batch, job('j1', 1));
    data.imports.addImport('org-a', batch, job('j2', 1));
    await batch.commit();
    const [a, b] = await Promise.all([
      data.imports.leaveAwaitingUpload('org-a', 'j1', 5, { status: 'queued' }),
      data.imports.leaveAwaitingUpload('org-a', 'j1', 6, { status: 'queued' }),
    ]);
    expect([a?.changed, b?.changed].filter(Boolean)).toHaveLength(1);
    expect(await data.imports.leaveAwaitingUpload('org-a', 'j1', 7, { status: 'queued' })).toEqual({
      changed: false,
      status: 'queued',
    });
    const error = { code: 'FILE_SIGNATURE_MISMATCH', message: 'x', retryable: false };
    expect(await data.imports.leaveAwaitingUpload('org-a', 'j2', 5, { status: 'failed', error })).toEqual({
      changed: true,
      status: 'failed',
    });
    expect(await data.imports.getImport('org-a', 'j2')).toMatchObject({ status: 'failed', error, startedAt: 5 });
    expect(await data.imports.leaveAwaitingUpload('org-b', 'j2', 5, { status: 'queued' })).toBeNull();
  });

  it('REL-06 ORG-03 a retry requeues the job with its error, wait and failures cleared, keeping its progress', async () => {
    const error = { code: 'LLM_UNAVAILABLE', message: 'x', retryable: true };
    const ref = db.doc('organizations/org-a/importJobs/j1');
    await ref.set({
      ...job('j1', 1),
      orgId: 'org-a',
      status: 'failed',
      error,
      failures: 4,
      aiCounted: true,
      progress: { pagesDone: 2, pagesTotal: 3, questionsFound: 5 },
    });
    const seen = await db.runTransaction(async (tx) => {
      const j = await data.imports.readImport('org-a', tx, 'j1');
      expect(await data.imports.readImport('org-b', tx, 'j1')).toBeNull();
      data.imports.requeue('org-a', tx, 'j1');
      return j;
    });
    expect(seen).toMatchObject({ status: 'failed', error });
    const after = (await ref.get()).data()!;
    expect(after).toMatchObject({ status: 'queued', failures: 0, aiCounted: true, progress: { pagesDone: 2 } });
    expect(after.error).toBeUndefined();
  });

  it('IMP-11 ORG-03 drafts are read in order in a transaction and written field by field, null removing one', async () => {
    const drafts = db.collection('organizations/org-a/importJobs/j1/drafts');
    const draft = (order: number) => ({
      order,
      sourcePage: 1,
      prompt: `Q${order}`,
      options: [],
      correctOptionIds: [],
      explanation: 'Because',
      difficultySuggested: true,
      images: [],
      flags: [],
      status: 'pending',
    });
    await drafts.doc('d0002').set(draft(2));
    await drafts.doc('d0001').set(draft(1));
    await db.runTransaction(async (tx) => {
      const list = await data.imports.readDrafts('org-a', tx, 'j1');
      expect(list.map((d) => [d.id, d.order])).toEqual([
        ['d0001', 1],
        ['d0002', 2],
      ]);
      expect(await data.imports.readDrafts('org-b', tx, 'j1')).toEqual([]);
      data.imports.writeDraft('org-a', tx, 'j1', 'd0002', { prompt: 'Edited', explanation: null });
    });
    const d2 = (await drafts.doc('d0002').get()).data()!;
    expect(d2).toMatchObject({ prompt: 'Edited', order: 2 });
    expect(d2.explanation).toBeUndefined();
  });
});
