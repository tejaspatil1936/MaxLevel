import { isEligible, type EligibilityRules, type EligibilityStudent } from '@mitaoe/shared';
import type { Data } from '../data';
import type { StudentRecord } from '../data/students';
import type { SeriesRecord } from '../data/series';

export interface MatchingStudent {
  id: string;
  name: string;
  prn: string;
  departmentId: string;
  graduationYear: number;
}

/** The fields of a student record the eligibility rules read. */
export const asEligibility = (s: StudentRecord): EligibilityStudent => ({
  id: s.id,
  status: s.status,
  departmentId: s.departmentId,
  graduationYear: s.graduationYear,
});

/**
 * Eligibility on the server (SER-04 to SER-08): the students a rule set admits, and the series a student may see.
 * Only registered students ever match; a test's rules apply on top of its series' rules.
 */
export function eligibilityService(data: Data) {
  return {
    /** The live count and matching list behind the eligibility editor (SER-07), sorted by name. */
    async matchingStudents(
      orgId: string,
      series: EligibilityRules,
      test?: EligibilityRules,
    ): Promise<MatchingStudent[]> {
      const students = await data.students.listStudents(orgId, { status: 'registered' });
      return students
        .filter((s) => isEligible(asEligibility(s), series, test))
        .map((s) => ({
          id: s.id,
          name: s.name ?? '',
          prn: s.prn ?? '',
          departmentId: s.departmentId ?? '',
          graduationYear: s.graduationYear ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    },

    /**
     * SER-02: the series a student sees: active ones whose rules admit them. The student dashboard
     * (GET /v1/student/dashboard, phase 3) lists its tests from these.
     */
    async visibleSeries(orgId: string, studentId: string): Promise<SeriesRecord[]> {
      const student = await data.students.getStudent(orgId, studentId);
      if (!student) return [];
      const active = await data.series.listSeries(orgId, { status: 'active' });
      return active.filter((s) => isEligible(asEligibility(student), s.eligibility));
    },
  };
}
export type EligibilityService = ReturnType<typeof eligibilityService>;
