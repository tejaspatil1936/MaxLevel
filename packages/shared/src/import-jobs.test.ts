import { describe, expect, it } from 'vitest';
import {
  importCreateSchema,
  importDraftIdsSchema,
  importDraftPatchSchema,
  importFiguresFolder,
  importFilePath,
  importJobViewSchema,
  importPagePath,
  importPageTask,
  importPartText,
  importRetryTask,
  importTask,
} from './import-jobs';

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

  it('IMP-03 ORG-03 page images and figures are kept under the job, in the organization', () => {
    expect(importPagePath('org-a', 'job1', 2, 'png')).toBe('organizations/org-a/imports/job1/pages/2.png');
    expect(importPagePath('org-a', 'job1', 3, 'pdf')).toBe('organizations/org-a/imports/job1/pages/3.pdf');
    expect(importFiguresFolder('org-a', 'job1')).toBe('organizations/org-a/imports/job1/figures/');
  });

  it('IMP-11 A11Y-10 the job view may carry data URLs of its draft images by path', () => {
    const view = {
      id: 'job1',
      testId: 't1',
      filename: 'paper.pdf',
      format: 'pdf',
      status: 'ready',
      progress: { pagesDone: 1, pagesTotal: 1, questionsFound: 0 },
      createdAt: 1,
      drafts: [],
    };
    expect(importJobViewSchema.parse(view)).not.toHaveProperty('imageUrls');
    const urls = { 'organizations/o/imports/job1/figures/d0001-1.png': 'data:image/png;base64,AA==' };
    expect(importJobViewSchema.parse({ ...view, imageUrls: urls }).imageUrls).toEqual(urls);
  });

  it('REL-06 a retry run is the same task at its schedule time, named apart from the first run', () => {
    expect(importRetryTask('org-a', 'job1', 'retry-1', 60_000)).toEqual({
      name: 'import-job1-retry-1',
      path: '/tasks/import',
      payload: { orgId: 'org-a', jobId: 'job1' },
      scheduleTime: 60_000,
    });
    expect(importRetryTask('org-a', 'job1', 'manual-5')).not.toHaveProperty('scheduleTime');
  });

  it('IMP-11 a part keeps at most 100,000 characters of its text, marked truncated when cut', () => {
    expect(importPartText(2, 'abc')).toEqual({ part: 2, text: 'abc', truncated: false });
    const long = importPartText(1, 'x'.repeat(100_001));
    expect([long.text.length, long.truncated]).toEqual([100_000, true]);
  });

  it('REL-06 the next page is a task of its own, due at once, named by the job and the page', () => {
    expect(importPageTask('org-a', 'job1', 3)).toEqual({
      name: 'import-job1-page-3',
      path: '/tasks/import',
      payload: { orgId: 'org-a', jobId: 'job1', page: 3 },
    });
  });

  it('SEC-04 test and draft IDs in import requests are letters, digits, _ and - only', () => {
    const ok = { testId: 'Ab_9-x', filename: 'paper.pdf', contentType: 'application/pdf', sizeBytes: 10 };
    expect(importCreateSchema.safeParse(ok).success).toBe(true);
    for (const testId of ['a/b', '..', 'a.b', '', 'x'.repeat(129)])
      expect(importCreateSchema.safeParse({ ...ok, testId }).success, testId).toBe(false);
    expect(importDraftIdsSchema.safeParse({ draftIds: ['d0001', 'd0002'] }).success).toBe(true);
    expect(importDraftIdsSchema.safeParse({ draftIds: ['d0001/x'] }).success).toBe(false);
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

  it('IMP-11 a draft edit takes any of its fields, nothing else, and at least one', () => {
    const ok = importDraftPatchSchema.safeParse({
      prompt: 'What is 2 + 2?',
      options: [
        { id: 'a', text: '3' },
        { id: 'b', text: '4' },
      ],
      correctOptionIds: ['b'],
      explanation: null,
      difficulty: 'easy',
      images: [{ path: 'organizations/o/imports/j/figures/d0001-1.png', alt: 'A chart' }],
    });
    expect(ok.success).toBe(true);
    expect(importDraftPatchSchema.safeParse({}).success, 'no field').toBe(false);
    expect(importDraftPatchSchema.safeParse({ status: 'approved' }).success, 'unknown field').toBe(false);
    expect(importDraftPatchSchema.safeParse({ correctOptionIds: ['g'] }).success, 'option g').toBe(false);
    const twice = [
      { id: 'a', text: '1' },
      { id: 'a', text: '2' },
    ];
    expect(importDraftPatchSchema.safeParse({ options: twice }).success, 'repeated option ID').toBe(false);
  });

  it('IMP-12 approve and discard take a non-empty list of draft IDs', () => {
    expect(importDraftIdsSchema.safeParse({ draftIds: ['d0001'] }).success).toBe(true);
    expect(importDraftIdsSchema.safeParse({ draftIds: [] }).success).toBe(false);
    expect(importDraftIdsSchema.safeParse({}).success).toBe(false);
  });
});
