import type { Settings, WhitelistEntry } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import type { Data } from '../data';
import type { SeriesRecord } from '../data/series';
import type { StudentRecord } from '../data/students';
import type { TestRecord } from '../data/tests';
import { adminDiagnosticService } from './admin-diagnostic';

describe('adminDiagnosticService', () => {
  const baseSeries: SeriesRecord = {
    id: 'series-1',
    title: 'Capgemini Placement Drive 2026',
    status: 'draft',
    startDate: '2026-10-21',
    endDate: '2026-10-22',
    defaults: {},
    eligibility: {
      departmentIds: ['dept-cse'],
      graduationYears: [2026],
      include: [],
      exclude: [],
    },
    createdAt: 1000,
    updatedAt: 1000,
  };

  const baseTest: TestRecord = {
    id: 'test-1',
    seriesId: 'series-1',
    title: 'Day 1: Aptitude Test',
    scheduledDate: '2026-10-21',
    dayHidden: false,
    overrides: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    sections: [],
    status: 'scheduled',
    questionSetVersion: 1,
    totalMarks: 50,
    attemptsStarted: false,
    resolved: {
      window: { start: 1000, end: 5000 },
      durationMin: 60,
    } as unknown as Settings,
    createdAt: 1000,
    updatedAt: 1000,
  };

  const mockData = (overrides?: {
    series?: SeriesRecord | null;
    test?: TestRecord | null;
    students?: StudentRecord[];
    whitelist?: WhitelistEntry[];
  }): Data =>
    ({
      tests: {
        getTest: async () => (overrides?.test !== undefined ? overrides.test : baseTest),
      },
      series: {
        getSeries: async () => (overrides?.series !== undefined ? overrides.series : baseSeries),
      },
      students: {
        listStudents: async () =>
          overrides?.students ?? [
            {
              id: 'stu-1',
              name: 'Rahul Sharma',
              email: 'rahul@mitaoe.ac.in',
              prn: 'PRN001',
              departmentId: 'dept-cse',
              graduationYear: 2026,
              status: 'registered',
            },
          ],
      },
      whitelist: {
        listWhitelist: async () => overrides?.whitelist ?? [],
      },
    }) as unknown as Data;

  it('detects when the parent series is in draft even if test is scheduled', async () => {
    const service = adminDiagnosticService(mockData({ series: { ...baseSeries, status: 'draft' } }));
    const result = await service.diagnoseTest('org-1', 'test-1', 2000);

    expect(result).not.toBeNull();
    expect(result?.isVisibleToStudents).toBe(false);
    expect(result?.issues.some((i) => i.code === 'SERIES_DRAFT')).toBe(true);
    expect(result?.summary).toContain('HIDDEN');
    expect(result?.summary).toContain('Parent Series is in Draft');
  });

  it('passes when both series and test are active and student matches eligibility', async () => {
    const service = adminDiagnosticService(mockData({ series: { ...baseSeries, status: 'active' } }));
    const result = await service.diagnoseTest('org-1', 'test-1', 2000);

    expect(result).not.toBeNull();
    expect(result?.isVisibleToStudents).toBe(true);
    expect(result?.eligibleStudentCount).toBe(1);
    expect(result?.issues.filter((i) => i.severity === 'critical')).toHaveLength(0);
  });

  it('detects when test status is not scheduled', async () => {
    const service = adminDiagnosticService(
      mockData({
        series: { ...baseSeries, status: 'active' },
        test: { ...baseTest, status: 'in_review' },
      }),
    );
    const result = await service.diagnoseTest('org-1', 'test-1', 2000);

    expect(result?.isVisibleToStudents).toBe(false);
    expect(result?.issues.some((i) => i.code === 'TEST_NOT_SCHEDULED')).toBe(true);
  });

  it('detects when exam window has expired', async () => {
    const service = adminDiagnosticService(mockData({ series: { ...baseSeries, status: 'active' } }));
    const result = await service.diagnoseTest('org-1', 'test-1', 6000); // 6000 > window.end (5000)

    expect(result?.isVisibleToStudents).toBe(false);
    expect(result?.issues.some((i) => i.code === 'WINDOW_EXPIRED')).toBe(true);
  });

  it('detects when zero registered students match department criteria', async () => {
    const service = adminDiagnosticService(
      mockData({
        series: { ...baseSeries, status: 'active' },
        students: [
          {
            id: 'stu-2',
            name: 'Pooja Patil',
            email: 'pooja@mitaoe.ac.in',
            prn: 'PRN002',
            departmentId: 'dept-mech', // mech vs series requiring cse
            graduationYear: 2026,
            status: 'registered',
          } as unknown as StudentRecord,
        ],
      }),
    );
    const result = await service.diagnoseTest('org-1', 'test-1', 2000);

    expect(result?.isVisibleToStudents).toBe(false);
    expect(result?.issues.some((i) => i.code === 'NO_MATCHING_STUDENTS')).toBe(true);
  });
});
