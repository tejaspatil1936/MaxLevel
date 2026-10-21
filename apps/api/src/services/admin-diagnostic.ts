import {
  isEligible,
  type DiagnosticCheck,
  type DiagnosticIssue,
  type DiagnosticReport,
  type EligibilityRules,
} from '@mitaoe/shared';
import type { Data } from '../data';
import type { SeriesRecord } from '../data/series';
import type { TestRecord } from '../data/tests';
import { asEligibility } from './eligibility';

export type VisibilityDiagnosticReport = DiagnosticReport;

export function adminDiagnosticService(data: Data) {
  return {
    async diagnoseTest(
      orgId: string,
      testId: string,
      now: number,
      studentQuery?: string,
    ): Promise<VisibilityDiagnosticReport | null> {
      const test: TestRecord | null = await data.tests.getTest(orgId, testId);
      if (!test) return null;

      const series: SeriesRecord | null = await data.series.getSeries(orgId, test.seriesId);
      const issues: DiagnosticIssue[] = [];
      const checks: DiagnosticCheck[] = [];

      // 1. Check Series Existence and Status
      if (!series) {
        issues.push({
          severity: 'critical',
          code: 'SERIES_NOT_FOUND',
          title: 'Parent Series Missing',
          message: `The parent series (${test.seriesId}) could not be found.`,
          howToFix: 'Assign this test to an existing series.',
        });
        checks.push({
          name: 'Parent Series',
          status: 'failed',
          detail: 'Series does not exist',
        });
      } else if (series.status !== 'active') {
        issues.push({
          severity: 'critical',
          code: 'SERIES_DRAFT',
          title: 'Parent Series is in Draft',
          message: `The parent series "${series.title}" is in "${series.status}" status. MaxLevel requires the series to be published ("active") for any test inside it to appear on student dashboards.`,
          howToFix: `Go to Series > "${series.title}" and click "Publish Series".`,
          actionHref: `/admin/series/edit?id=${series.id}`,
          actionLabel: 'Publish Series',
        });
        checks.push({
          name: 'Series Status',
          status: 'failed',
          detail: `Series is ${series.status} (must be active)`,
        });
      } else {
        checks.push({
          name: 'Series Status',
          status: 'passed',
          detail: `Series "${series.title}" is active`,
        });
      }

      // 2. Check Test Status
      if (test.status !== 'scheduled') {
        issues.push({
          severity: 'critical',
          code: 'TEST_NOT_SCHEDULED',
          title: 'Test is Not Scheduled',
          message: `Test status is currently "${test.status}". Only tests with status "scheduled" appear on student dashboards.`,
          howToFix: 'Open the test review screen, approve the questions, and publish the test.',
          actionHref: `/admin/tests/edit?id=${test.id}`,
          actionLabel: 'Publish Test',
        });
        checks.push({
          name: 'Test Status',
          status: 'failed',
          detail: `Test is ${test.status} (must be scheduled)`,
        });
      } else {
        checks.push({
          name: 'Test Status',
          status: 'passed',
          detail: 'Test is scheduled',
        });
      }

      // 3. Check Window and Timings
      const window = test.resolved?.window;
      if (!window) {
        issues.push({
          severity: 'critical',
          code: 'WINDOW_NOT_RESOLVED',
          title: 'Exam Window Not Set',
          message: 'The examination start and end times have not been resolved.',
          howToFix: 'Edit test schedule settings to set a valid test window.',
          actionHref: `/admin/tests/edit?id=${test.id}`,
          actionLabel: 'Set Window',
        });
        checks.push({
          name: 'Schedule Window',
          status: 'failed',
          detail: 'Window not resolved',
        });
      } else if (now > window.end) {
        issues.push({
          severity: 'critical',
          code: 'WINDOW_EXPIRED',
          title: 'Exam Window Has Ended',
          message: `The examination window closed on ${new Date(window.end).toLocaleString('en-IN')}. Students can no longer start this test.`,
          howToFix: 'Extend the test window if students still need to sit for this exam.',
          actionHref: `/admin/tests/edit?id=${test.id}`,
          actionLabel: 'Extend Window',
        });
        checks.push({
          name: 'Schedule Window',
          status: 'failed',
          detail: 'Window has ended',
        });
      } else if (now < window.start) {
        issues.push({
          severity: 'info',
          code: 'WINDOW_FUTURE',
          title: 'Test Starts in the Future',
          message: `The test opens on ${new Date(window.start).toLocaleString('en-IN')}. Students will see it in their "Upcoming Tests" list, but cannot begin answering until the window opens.`,
          howToFix: 'No action needed if scheduled intentionally. If you want students to start now, update the start time.',
          actionHref: `/admin/tests/edit?id=${test.id}`,
          actionLabel: 'Edit Start Time',
        });
        checks.push({
          name: 'Schedule Window',
          status: 'warning',
          detail: 'Scheduled for upcoming time',
        });
      } else {
        checks.push({
          name: 'Schedule Window',
          status: 'passed',
          detail: 'Window is currently open',
        });
      }

      // 4. Check Student Population & Eligibility
      const registeredStudents = await data.students.listStudents(orgId, { status: 'registered' });
      const seriesRules: EligibilityRules = series?.eligibility ?? {
        departmentIds: [],
        graduationYears: [],
        include: [],
        exclude: [],
      };
      const testRules: EligibilityRules = test.eligibility ?? {
        departmentIds: [],
        graduationYears: [],
        include: [],
        exclude: [],
      };

      const eligibleStudents = registeredStudents.filter((s) =>
        isEligible(asEligibility(s), seriesRules, testRules),
      );

      if (registeredStudents.length === 0) {
        const whitelist = await data.whitelist.listWhitelist(orgId);
        const invited = whitelist.filter((w) => w.status === 'invited');
        issues.push({
          severity: 'warning',
          code: 'ALL_STUDENTS_INVITED',
          title: 'No Registered Students in Organization',
          message: `You have ${invited.length} students on your whitelist, but 0 have signed in to complete registration. Students only see tests once they log in for the first time.`,
          howToFix: 'Ask students to sign in at least once before the exam starts.',
          actionHref: '/admin/whitelist/',
          actionLabel: 'View Whitelist',
        });
        checks.push({
          name: 'Student Registration',
          status: 'warning',
          detail: '0 registered students (all invited)',
        });
      } else if (eligibleStudents.length === 0) {
        issues.push({
          severity: 'critical',
          code: 'NO_MATCHING_STUDENTS',
          title: '0 Registered Students Match Eligibility',
          message: `Out of ${registeredStudents.length} registered students, 0 meet the branch or batch rules configured for this test.`,
          howToFix: 'Check department and graduation year filters in the Series or Test settings.',
          actionHref: series ? `/admin/series/edit?id=${series.id}` : undefined,
          actionLabel: 'Edit Eligibility',
        });
        checks.push({
          name: 'Eligibility Rules',
          status: 'failed',
          detail: '0 students match filters',
        });
      } else {
        checks.push({
          name: 'Eligibility Rules',
          status: 'passed',
          detail: `${eligibleStudents.length} of ${registeredStudents.length} registered students eligible`,
        });
      }

      // 5. Specific Student Query (Optional)
      if (studentQuery) {
        const q = studentQuery.toLowerCase().trim();
        const target = registeredStudents.find(
          (s) => s.email?.toLowerCase() === q || s.prn?.toLowerCase() === q || s.id === q,
        );
        if (!target) {
          issues.push({
            severity: 'warning',
            code: 'STUDENT_NOT_FOUND',
            title: `Student "${studentQuery}" Not Found`,
            message: `Could not find a registered student matching "${studentQuery}". They may only be on the whitelist (invited) or misspelled.`,
            howToFix: 'Check the Whitelist tab to verify their email address.',
            actionHref: '/admin/whitelist/',
            actionLabel: 'Check Whitelist',
          });
        } else {
          const eligible = isEligible(asEligibility(target), seriesRules, testRules);
          if (!eligible) {
            issues.push({
              severity: 'critical',
              code: 'STUDENT_NOT_ELIGIBLE',
              title: `Student "${target.name}" is Not Eligible`,
              message: `Student belongs to department "${target.departmentId ?? 'none'}" (Batch: ${target.graduationYear ?? 'none'}), which is excluded by the series/test eligibility criteria.`,
              howToFix: 'Update the series eligibility rules to include this department/batch.',
              actionHref: series ? `/admin/series/edit?id=${series.id}` : undefined,
              actionLabel: 'Update Rules',
            });
          }
        }
      }

      const criticalCount = issues.filter((i) => i.severity === 'critical').length;
      const isVisibleToStudents =
        series?.status === 'active' &&
        test.status === 'scheduled' &&
        !!window &&
        now <= window.end &&
        eligibleStudents.length > 0;

      let summary = '';
      if (isVisibleToStudents) {
        summary = `Test "${test.title}" is visible to ${eligibleStudents.length} registered student(s).`;
      } else if (criticalCount > 0) {
        const primaryIssue = issues.find((i) => i.severity === 'critical');
        summary = `Test "${test.title}" is currently HIDDEN from students. Primary reason: ${primaryIssue?.title}.`;
      } else {
        summary = `Test "${test.title}" has warnings that may affect visibility.`;
      }

      return {
        testId: test.id,
        testTitle: test.title,
        testStatus: test.status,
        seriesId: test.seriesId,
        seriesTitle: series?.title ?? 'Unknown',
        seriesStatus: series?.status ?? 'unknown',
        isVisibleToStudents,
        eligibleStudentCount: eligibleStudents.length,
        totalRegisteredCount: registeredStudents.length,
        issues,
        checks,
        summary,
      };
    },
  };
}
export type AdminDiagnosticService = ReturnType<typeof adminDiagnosticService>;
