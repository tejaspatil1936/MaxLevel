import { describe, expect, it } from 'vitest';
import { llmScriptSchema } from './import-llm';
import { reportFilename, reportFilePath, reportRequestSchema, reportTask } from './reports';

describe('report requests, files and tasks', () => {
  it('EXP-06 a request names a test or a series, with an optional XLSX', () => {
    expect(reportRequestSchema.parse({ scope: 'test', refId: 't1' })).toEqual({ scope: 'test', refId: 't1' });
    expect(reportRequestSchema.parse({ scope: 'series', refId: 's1', includeXlsx: true }).includeXlsx).toBe(true);
    for (const bad of [{ scope: 'course', refId: 't1' }, { scope: 'test', refId: '' }, { scope: 'test' }])
      expect(reportRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('EXP-06 files are stored at the exact paths and downloaded under the exact names', () => {
    expect(reportFilePath('org-a', 'r1', 'pdf')).toBe('organizations/org-a/reports/r1/report.pdf');
    expect(reportFilePath('org-a', 'r1', 'xlsx')).toBe('organizations/org-a/reports/r1/metrics.xlsx');
    expect(reportFilename('r1', 'pdf')).toBe('report-r1.pdf');
    expect(reportFilename('r1', 'xlsx')).toBe('report-r1-metrics.xlsx');
  });

  it('EXP-06 REL-06 the task is report-<id>; a later run keeps the ID in its name and has its own schedule', () => {
    expect(reportTask('org-a', 'r1')).toEqual({
      name: 'report-r1',
      path: '/tasks/report',
      payload: { orgId: 'org-a', reportId: 'r1' },
    });
    expect(reportTask('org-a', 'r1', 'retry-1-60000', 60_000)).toEqual({
      name: 'report-r1-retry-1-60000',
      path: '/tasks/report',
      payload: { orgId: 'org-a', reportId: 'r1' },
      scheduleTime: 60_000,
    });
  });

  it('EXP-05 the mock model script takes report answers and failures', () => {
    const script = llmScriptSchema.parse({
      report: { answers: [{ summary: 'S.', recommendations: ['R.'] }], failures: 1 },
    });
    expect(script.report).toEqual({ answers: [{ summary: 'S.', recommendations: ['R.'] }], failures: 1 });
    expect(llmScriptSchema.safeParse({ report: { answers: [], failures: -1 } }).success).toBe(false);
  });
});
