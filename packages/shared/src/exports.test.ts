import { describe, expect, it } from 'vitest';
import {
  exportDateTime,
  exportFilename,
  exportInfoSchema,
  exportRequestSchema,
  exportTask,
  EXPORT_LINK_TTL_MS,
  seriesExportColumns,
  testExportColumns,
  xlsxSheetName,
  xlsxSheetNames,
  zoneShortName,
} from './exports';

const NOV_2_0930_IST = 1793592000000;

describe('results export columns', () => {
  it('EXP-01 testExportColumns lists every column in order, one per section, times named by the zone', () => {
    expect(testExportColumns([], 'IST')).toEqual([
      'Name',
      'Email',
      'PRN',
      'Department',
      'Graduation year',
      'Status',
      'Score',
      'Maximum',
      'Percentage',
      'Rank',
      'Correct',
      'Incorrect',
      'Unanswered',
      'Started at (IST)',
      'Submitted at (IST)',
      'Time taken (seconds)',
      'Strikes',
      'Termination reason',
      'Extra time (minutes)',
    ]);
    const sectioned = testExportColumns([{ name: 'Quant' }, { name: 'Verbal' }], 'IST');
    expect(sectioned.slice(9, 13)).toEqual(['Rank', 'Quant score', 'Verbal score', 'Correct']);
    expect(sectioned).toHaveLength(21);
  });

  it('EXP-02 seriesExportColumns has the profile, one column per test heading, the total and the rank', () => {
    expect(seriesExportColumns(['Day 1: Quantitative aptitude', 'Day 2: Verbal ability'])).toEqual([
      'Name',
      'Email',
      'PRN',
      'Department',
      'Graduation year',
      'Day 1: Quantitative aptitude',
      'Day 2: Verbal ability',
      'Total',
      'Rank',
    ]);
  });

  it('EXP-02 xlsxSheetName removes forbidden characters, collapses spaces and keeps at most 31 characters', () => {
    expect(xlsxSheetName('Day 1: Quantitative aptitude')).toBe('Day 1 Quantitative aptitude');
    expect(xlsxSheetName('A/B \\ C? *D* [E]')).toBe('AB C D E');
    expect(xlsxSheetName('  Day   3:   Logical   reasoning  ')).toBe('Day 3 Logical reasoning');
    const long = xlsxSheetName('Day 12: Data interpretation and analysis, part two');
    expect(long).toBe('Day 12 Data interpretation and');
    expect(long.length).toBeLessThanOrEqual(31);
  });

  it('EXP-02 sheet names stay unique ignoring case and never take a reserved name', () => {
    expect(xlsxSheetNames(['Mock', 'mock', 'Series', ':'], ['Series'])).toEqual([
      'Mock',
      'mock (2)',
      'Series (2)',
      'Test',
    ]);
    const long = 'x'.repeat(40);
    const names = xlsxSheetNames([long, long]);
    expect(names[1]).toBe(`${'x'.repeat(27)} (2)`);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });
});

describe('results export files', () => {
  it('EXP-01 times read yyyy-MM-dd HH:mm:ss in the organization timezone, named IST for Asia/Kolkata', () => {
    expect(exportDateTime(NOV_2_0930_IST, 'Asia/Kolkata')).toBe('2026-11-02 09:30:00');
    expect(exportDateTime(NOV_2_0930_IST + 61_000, 'UTC')).toBe('2026-11-02 04:01:01');
    expect(zoneShortName('Asia/Kolkata', NOV_2_0930_IST)).toBe('IST');
  });

  it('EXP-03 file names, the 15-minute link and one export task per export', () => {
    expect(exportFilename('test', 't1', 'csv')).toBe('results-t1.csv');
    expect(exportFilename('series', 's1', 'xlsx')).toBe('series-results-s1.xlsx');
    expect(EXPORT_LINK_TTL_MS).toBe(900_000);
    expect(exportTask('org-a', 'e1')).toEqual({
      name: 'export-org-a-e1',
      path: '/tasks/export',
      payload: { orgId: 'org-a', exportId: 'e1' },
    });
  });

  it('EXP-03 requests name a scope, a reference and a format; answers carry the link only when given', () => {
    expect(exportRequestSchema.safeParse({ scope: 'test', refId: 't1', format: 'csv' }).success).toBe(true);
    expect(exportRequestSchema.safeParse({ scope: 'org', refId: 't1', format: 'csv' }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ scope: 'test', refId: '', format: 'pdf' }).success).toBe(false);
    const info = { id: 'e1', scope: 'test', refId: 't1', format: 'csv', status: 'queued' };
    expect(exportInfoSchema.parse({ ...info, secret: 'x' })).toEqual(info);
  });
});
