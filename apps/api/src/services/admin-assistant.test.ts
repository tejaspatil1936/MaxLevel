import type { Settings, WhitelistEntry } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import type { Data } from '../data';
import type { SeriesRecord } from '../data/series';
import type { StudentRecord } from '../data/students';
import type { TestRecord } from '../data/tests';
import type { EntitlementsService } from './entitlements';
import { createAdminAssistantService } from './admin-assistant';

describe('createAdminAssistantService', () => {
  const baseSeries: SeriesRecord = {
    id: 'series-1',
    title: 'Barclays Placement 2026',
    status: 'active',
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
    title: 'Day 1 Aptitude Test',
    dayNumber: '1',
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
    seriesList?: SeriesRecord[];
    testsList?: TestRecord[];
    students?: StudentRecord[];
    whitelist?: WhitelistEntry[];
  }): Data =>
    ({
      tests: {
        getTest: async () => baseTest,
        listTests: async () =>
          (overrides?.testsList ?? [baseTest]).map((t) => ({
            id: t.id,
            seriesId: t.seriesId,
            title: t.title,
            dayNumber: t.dayNumber,
            status: t.status,
            totalMarks: t.totalMarks,
            attemptsStarted: t.attemptsStarted,
            window: { start: 1000, end: 5000 },
            durationMin: 60,
            eligibility: { departments: ['dept-cse'], graduationYears: [2026] },
          })),
      },
      series: {
        getSeries: async () => baseSeries,
        listSeries: async () => overrides?.seriesList ?? [baseSeries],
      },
      students: {
        listStudents: async () => overrides?.students ?? [],
      },
      whitelist: {
        listWhitelist: async () => overrides?.whitelist ?? [],
      },
      attempts: {
        listTestAttempts: async () => [],
      },
    }) as unknown as Data;

  it('handles general questions or math query fallback correctly', async () => {
    const service = createAdminAssistantService(mockData());
    const res = await service.chat('org-1', [{ role: 'user', content: 'what is 2 + 2' }], 2000);
    expect(res.reply).toBeDefined();
    expect(res.reply.length).toBeGreaterThan(0);
    expect(res.suggestions).toBeDefined();
  });

  it('runs diagnostic when visibility query is asked', async () => {
    const service = createAdminAssistantService(mockData());
    const res = await service.chat('org-1', [{ role: 'user', content: "Why can't students see my test?" }], 6000);
    expect(res.reply).toBeDefined();
    expect(res.diagnostic).toBeDefined();
    expect(res.diagnostic?.testTitle).toBe('Day 1 Aptitude Test');
    expect(res.diagnostic?.isVisibleToStudents).toBe(false);
  });

  it('provides operational assistance for extra time', async () => {
    const service = createAdminAssistantService(mockData());
    const res = await service.chat('org-1', [{ role: 'user', content: 'How do I grant extra time?' }], 2000);
    expect(res.reply).toContain('Extra Time');
    expect(res.reply).toContain('/admin/live');
  });

  it('explains difference between whitelist and students', async () => {
    const service = createAdminAssistantService(mockData());
    const res = await service.chat(
      'org-1',
      [{ role: 'user', content: 'difference between whitelist and students' }],
      2000,
    );
    expect(res.reply).toContain('Whitelist');
    expect(res.reply).toContain('Students Tab');
  });

  it('strictly refuses to generate or create questions and directs to Test Editor', async () => {
    const service = createAdminAssistantService(mockData());
    const res = await service.chat(
      'org-1',
      [{ role: 'user', content: 'Can you generate 10 questions for this test?' }],
      2000,
    );
    expect(res.reply).toContain('Human-Only Question Authoring Boundary');
    expect(res.reply).toContain('Test Editor');
    expect(res.proposal).toBeUndefined();
  });

  it('notifies admin when AI series management is disabled', async () => {
    const mockEntitlements = {
      get: async () => ({ features: { ai_assistant_write: false } }),
    } as unknown as EntitlementsService;
    const service = createAdminAssistantService(mockData(), mockEntitlements);
    const res = await service.chat('org-1', [{ role: 'user', content: 'Please create series for TCS NQT 2026' }], 2000);
    expect(res.reply).toContain('AI-Assisted Management is Disabled');
    expect(res.reply).toContain('Organization Settings');
    expect(res.proposal).toBeUndefined();
  });

  it('creates action proposal for series when AI series management is enabled', async () => {
    const mockEntitlements = {
      get: async () => ({ features: { ai_assistant_write: true } }),
    } as unknown as EntitlementsService;
    const service = createAdminAssistantService(mockData(), mockEntitlements);
    const res = await service.chat(
      'org-1',
      [{ role: 'user', content: 'Please create series called "TCS NQT 2026 Season 1"' }],
      2000,
    );
    expect(res.proposal).toBeDefined();
    expect(res.proposal?.actionType).toBe('create_series');
    expect(res.proposal?.title).toContain('TCS NQT 2026 Season 1');
    expect(res.proposal?.seriesData?.title).toBe('TCS NQT 2026 Season 1');
    expect(res.proposal?.diffs.length).toBeGreaterThan(0);
    expect(res.proposal?.warning).toContain('Questions must be uploaded and approved manually');
  });

  it('creates action proposal for test when AI series management is enabled', async () => {
    const mockEntitlements = {
      get: async () => ({ features: { ai_assistant_write: true } }),
    } as unknown as EntitlementsService;
    const service = createAdminAssistantService(mockData(), mockEntitlements);
    const res = await service.chat(
      'org-1',
      [{ role: 'user', content: 'Please create test called "Cognitive Aptitude Round 1"' }],
      2000,
    );
    expect(res.proposal).toBeDefined();
    expect(res.proposal?.actionType).toBe('create_test');
    expect(res.proposal?.title).toContain('Cognitive Aptitude Round 1');
    expect(res.proposal?.testData?.title).toBe('Cognitive Aptitude Round 1');
    expect(res.proposal?.testData?.seriesId).toBe('series-1');
  });
});
