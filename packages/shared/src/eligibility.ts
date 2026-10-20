import { z } from 'zod';

// Eligibility (spec 5.3). Include and exclude lists hold student IDs (docs/testids/phase-2.md).

export const eligibilityRulesSchema = z.object({
  departmentIds: z.array(z.string().min(1)).max(500).default([]),
  graduationYears: z.array(z.number().int().min(2000).max(2100)).max(50).default([]),
  include: z.array(z.string().min(1)).max(5000).default([]),
  exclude: z.array(z.string().min(1)).max(5000).default([]),
});

export interface EligibilityRules {
  departmentIds: string[];
  graduationYears: number[];
  include: string[];
  exclude: string[];
}

/** All four lists empty: everyone registered matches (SER-05). */
export const NO_RESTRICTION: EligibilityRules = { departmentIds: [], graduationYears: [], include: [], exclude: [] };

export interface EligibilityStudent {
  id: string;
  status: 'invited' | 'registered' | 'disabled';
  departmentId: string | null;
  graduationYear: number | null;
}

/**
 * One rule set (SER-05): not excluded, and either on the include list or matching every non-empty filter
 * (department any of the selected, graduation year any of the selected). Exclude beats include.
 */
export function matchesRules(student: EligibilityStudent, rules: EligibilityRules): boolean {
  if (rules.exclude.includes(student.id)) return false;
  if (rules.include.includes(student.id)) return true;
  const deptOk =
    rules.departmentIds.length === 0 ||
    (student.departmentId !== null && rules.departmentIds.includes(student.departmentId));
  const yearOk =
    rules.graduationYears.length === 0 ||
    (student.graduationYear !== null && rules.graduationYears.includes(student.graduationYear));
  return deptOk && yearOk;
}

/**
 * Only registered students ever match (SER-04). A test's rules apply on top of the series' rules, so both must
 * match: a test can narrow the series but never widen it (SER-06).
 */
export function isEligible(student: EligibilityStudent, series: EligibilityRules, test?: EligibilityRules): boolean {
  if (student.status !== 'registered') return false;
  if (!matchesRules(student, series)) return false;
  return test === undefined || matchesRules(student, test);
}
