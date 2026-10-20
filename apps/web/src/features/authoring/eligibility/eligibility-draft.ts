import type { EligibilityRules } from '@mitaoe/shared';

// The eligibility editor's draft (docs/testids/phase-2.md, "Eligibility editor"). People type emails or PRNs, one
// per line; the rules store student IDs (SER-05).

export interface EligibilityDraft {
  departmentIds: string[];
  graduationYears: number[];
  include: string;
  exclude: string;
}

export const EMPTY_ELIGIBILITY: EligibilityDraft = { departmentIds: [], graduationYears: [], include: '', exclude: '' };

export interface StudentRef {
  id: string;
  email: string;
  prn: string;
}

/** Student IDs by email, PRN (both without case) and ID. */
export type StudentLookup = Map<string, string>;

const norm = (s: string) => s.trim().toLowerCase();

export function studentLookup(students: readonly StudentRef[]): StudentLookup {
  const map: StudentLookup = new Map();
  for (const s of students) for (const key of [s.id, s.email, s.prn]) if (key) map.set(norm(key), s.id);
  return map;
}

/** The non-empty lines of a list field. */
export const entriesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function resolve(text: string, lookup: StudentLookup | undefined) {
  const ids: string[] = [];
  const unknown: string[] = [];
  if (!lookup) return { ids, unknown };
  for (const entry of entriesOf(text)) {
    const id = lookup.get(norm(entry));
    if (!id) unknown.push(entry);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

/**
 * The rules a draft stands for, and the entries that match no student. Until the students are loaded, the lists
 * resolve to nothing and nothing is reported.
 */
export function resolveDraft(draft: EligibilityDraft, lookup: StudentLookup | undefined) {
  const include = resolve(draft.include, lookup);
  const exclude = resolve(draft.exclude, lookup);
  const rules: EligibilityRules = {
    departmentIds: draft.departmentIds,
    graduationYears: draft.graduationYears,
    include: include.ids,
    exclude: exclude.ids,
  };
  return { rules, unknown: { include: include.unknown, exclude: exclude.unknown } };
}

/** A draft for stored rules: each listed student is shown by email (by ID if the student is gone). */
export function draftFromRules(rules: EligibilityRules, students: readonly StudentRef[]): EligibilityDraft {
  const email = new Map(students.map((s) => [s.id, s.email]));
  const lines = (ids: string[]) => ids.map((id) => email.get(id) ?? id).join('\n');
  return {
    departmentIds: [...rules.departmentIds],
    graduationYears: [...rules.graduationYears],
    include: lines(rules.include),
    exclude: lines(rules.exclude),
  };
}
