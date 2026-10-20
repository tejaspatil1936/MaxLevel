import { describe, expect, it } from 'vitest';
import { buildImportReport, isValidEmail, normalizeEmail } from './people';

describe('whitelist import report', () => {
  it('WL-01 emails are stored lowercase and trimmed', () => {
    expect(normalizeEmail('  Student01@A.Test ')).toBe('student01@a.test');
  });

  it('WL-03 reports invalid emails, duplicates in the file, existing entries and the limit, with row numbers', () => {
    const r = buildImportReport(
      [
        { email: 'a@x.test' },
        { email: 'not-an-email' },
        { email: 'A@X.test ' },
        { email: 'old@x.test' },
        { email: 'b@x.test', prn: 'P1' },
      ],
      new Set(['old@x.test']),
      { maxStudents: 10, currentCount: 9 },
    );
    expect(r.invalid).toEqual([{ row: 2, email: 'not-an-email' }]);
    expect(r.duplicatesInFile).toEqual([{ row: 3, email: 'a@x.test' }]);
    expect(r.existing).toEqual([{ row: 4, email: 'old@x.test' }]);
    expect(r.accepted.map((a) => a.email)).toEqual(['a@x.test', 'b@x.test']);
    expect([r.total, r.valid, r.toAdd, r.overLimit]).toEqual([5, 4, 2, true]);
  });

  it('WL-03 a file within the limit is not over it', () => {
    expect(
      buildImportReport([{ email: 'a@x.test' }], new Set(), { maxStudents: 2000, currentCount: 1999 }).overLimit,
    ).toBe(false);
    expect(isValidEmail('first.last+tag@college.ac.in')).toBe(true);
    expect(isValidEmail('two@@signs.test')).toBe(false);
  });
});
