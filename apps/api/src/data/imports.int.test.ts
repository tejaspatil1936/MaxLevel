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
});
