import { describe, expect, it } from 'vitest';
import { importCreateSchema, importFilePath, importTask } from './import-jobs';

describe('import jobs', () => {
  it('IMP-01 the source file is kept at the job path with its lower-case extension', () => {
    expect(importFilePath('org-a', 'job1', 'pdf')).toBe('organizations/org-a/imports/job1/source.pdf');
  });

  it('IMP-01 the import task goes to /tasks/import with a name containing the job ID', () => {
    expect(importTask('org-a', 'job1')).toEqual({
      name: 'import-job1',
      path: '/tasks/import',
      payload: { orgId: 'org-a', jobId: 'job1' },
    });
  });

  it('IMP-02 the create request needs every field and a whole, non-negative size', () => {
    const ok = { testId: 't1', filename: 'paper.pdf', contentType: 'application/pdf', sizeBytes: 10 };
    expect(importCreateSchema.safeParse(ok).success).toBe(true);
    for (const k of Object.keys(ok)) {
      const { [k as keyof typeof ok]: _drop, ...rest } = ok;
      expect(importCreateSchema.safeParse(rest).success, `without ${k}`).toBe(false);
    }
    expect(importCreateSchema.safeParse({ ...ok, sizeBytes: -1 }).success).toBe(false);
    expect(importCreateSchema.safeParse({ ...ok, sizeBytes: 1.5 }).success).toBe(false);
  });
});
