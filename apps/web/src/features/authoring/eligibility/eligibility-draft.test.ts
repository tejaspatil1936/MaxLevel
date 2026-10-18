import { NO_RESTRICTION } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { draftFromRules, EMPTY_ELIGIBILITY, resolveDraft, studentLookup } from './eligibility-draft';

const students = [
  { id: 'stu-1', email: 'student01@a.test', prn: '22010101' },
  { id: 'stu-3', email: 'student03@a.test', prn: '22010103' },
];
const lookup = studentLookup(students);

describe('eligibility draft', () => {
  it('SER-05 SER-07 include and exclude entries are emails or PRNs, one per line, stored as student IDs', () => {
    const draft = {
      ...EMPTY_ELIGIBILITY,
      departmentIds: ['dept-it'],
      include: ' 22010103 \n\nSTUDENT01@A.test\nstudent03@a.test',
      exclude: 'stu-1',
    };
    expect(resolveDraft(draft, lookup)).toEqual({
      rules: { departmentIds: ['dept-it'], graduationYears: [], include: ['stu-3', 'stu-1'], exclude: ['stu-1'] },
      unknown: { include: [], exclude: [] },
    });
  });

  it('SER-07 an entry that matches no student is reported, and nothing is reported before the students load', () => {
    const draft = { ...EMPTY_ELIGIBILITY, include: 'nobody@a.test\n22010101', exclude: 'P-404' };
    expect(resolveDraft(draft, lookup).unknown).toEqual({ include: ['nobody@a.test'], exclude: ['P-404'] });
    expect(resolveDraft(draft, undefined)).toEqual({ rules: NO_RESTRICTION, unknown: { include: [], exclude: [] } });
  });

  it('SER-05 stored rules show each listed student by email, and by ID once the student is gone', () => {
    const rules = { ...NO_RESTRICTION, graduationYears: [2026], include: ['stu-3', 'stu-gone'], exclude: ['stu-1'] };
    expect(draftFromRules(rules, students)).toEqual({
      departmentIds: [],
      graduationYears: [2026],
      include: 'student03@a.test\nstu-gone',
      exclude: 'student01@a.test',
    });
  });
});
