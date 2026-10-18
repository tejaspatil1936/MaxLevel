import {
  dayLabels,
  drawSize,
  examEntrySchema,
  isEligible,
  isFinishedAttempt,
  lastStartAt,
  resolveSettings,
  studentTestState,
  testDrawPools,
  type CompletedTest,
  type Settings,
  type StudentDashboard,
  type StudentTestPage,
  type StudentTestState,
  type StudentTestSummary,
} from '@mitaoe/shared';
import type { Data } from '../data';
import type { StudentAttemptRef } from '../data/attempts';
import type { SeriesRecord } from '../data/series';
import type { TestRecord } from '../data/tests';
import { asEligibility } from './eligibility';

interface Listed {
  test: TestRecord;
  dayLabel: string | null;
  settings: Settings & { window: NonNullable<Settings['window']> };
  state: Exclude<StudentTestState, 'finished'>;
  attempt?: StudentAttemptRef;
}

/**
 * What a student sees of their organization's tests (US-ST-03, SER-02, SER-04 to SER-06): scheduled tests of active
 * series whose series and test rules admit them, by state at the server's `now`, and every test they finished.
 */
export function studentTestsService(data: Data) {
  async function view(orgId: string, studentId: string, now: number) {
    const [org, student, attempts, active] = await Promise.all([
      data.orgs.getOrg(orgId),
      data.students.getStudent(orgId, studentId),
      data.attempts.listStudentAttempts(orgId, studentId),
      data.series.listSeries(orgId, { status: 'active' }),
    ]);
    const timezone = org?.timezone ?? 'Asia/Kolkata';
    const who = student ? asEligibility(student) : null;
    const visible = who ? active.filter((s) => isEligible(who, s.eligibility)) : [];
    // The newest attempt of each test decides; a reset attempt is as good as none.
    const latest = new Map<string, StudentAttemptRef>();
    for (const a of attempts) if (a.status !== 'reset' && !latest.has(a.testId)) latest.set(a.testId, a);
    const finished = [...latest.values()].filter((a) => isFinishedAttempt(a.status));

    const seriesIds = new Set([
      ...visible.map((s) => s.id),
      ...finished.flatMap((a) => (a.seriesId ? [a.seriesId] : [])),
    ]);
    const lists = await Promise.all([...seriesIds].map((id) => data.tests.listTests(orgId, id)));
    const tests = new Map<string, { test: TestRecord; dayLabel: string | null }>();
    for (const list of lists) {
      const labels = dayLabels(list);
      for (const test of list) tests.set(test.id, { test, dayLabel: labels[test.id] ?? null });
    }

    const admitting = new Map(visible.map((s) => [s.id, s]));
    const listed: Listed[] = [];
    for (const { test, dayLabel } of tests.values()) {
      const series = admitting.get(test.seriesId);
      if (!series || !who || test.status !== 'scheduled' || !test.resolved?.window) continue;
      if (!isEligible(who, series.eligibility, test.eligibility)) continue;
      const attempt = latest.get(test.id);
      const settings = test.resolved as Listed['settings'];
      const state = studentTestState(settings, now, attempt?.status);
      if (state && state !== 'finished')
        listed.push({ test, dayLabel, settings, state, ...(attempt ? { attempt } : {}) });
    }
    return { timezone, listed, finished, tests };
  }

  const summary = (l: Listed): StudentTestSummary => ({
    testId: l.test.id,
    title: l.test.title,
    dayLabel: l.dayLabel,
    ...(l.test.company ? { company: l.test.company } : {}),
    window: l.settings.window,
    durationMin: l.settings.durationMin,
    lastStartAt: lastStartAt(l.settings),
    ...(l.state === 'in_progress' && l.attempt ? { attemptId: l.attempt.id } : {}),
  });

  return {
    /** GET /v1/student/dashboard: live by last start time, upcoming by window start, completed newest first. */
    async dashboard(orgId: string, studentId: string, now: number): Promise<StudentDashboard> {
      const v = await view(orgId, studentId, now);
      const live = v.listed.filter((l) => l.state !== 'upcoming').map(summary);
      const upcoming = v.listed.filter((l) => l.state === 'upcoming').map(summary);
      const completed: CompletedTest[] = [];
      for (const a of v.finished) {
        const t = v.tests.get(a.testId) ?? (await testOf(orgId, a.testId));
        if (!t) continue;
        completed.push({
          testId: a.testId,
          title: t.test.title,
          dayLabel: t.dayLabel,
          attemptId: a.id,
          status: a.status as CompletedTest['status'],
          finishedAt: a.submittedAt ?? a.startedAt,
        });
      }
      const byTitle = (a: StudentTestSummary, b: StudentTestSummary) => a.title.localeCompare(b.title);
      return {
        timezone: v.timezone,
        live: live.sort((a, b) => a.lastStartAt - b.lastStartAt || byTitle(a, b)),
        upcoming: upcoming.sort((a, b) => a.window.start - b.window.start || byTitle(a, b)),
        completed: completed.sort((a, b) => b.finishedAt - a.finishedAt),
      };
    },

    /** GET /v1/student/tests/{id}: the test page, or null for a test the dashboard would not list. */
    async testPage(orgId: string, studentId: string, testId: string, now: number): Promise<StudentTestPage | null> {
      const v = await view(orgId, studentId, now);
      const listed = v.listed.find((l) => l.test.id === testId);
      const done = v.finished.find((a) => a.testId === testId);
      let page: Listed | null = listed ?? null;
      if (!page && done) {
        const t = v.tests.get(testId) ?? (await testOf(orgId, testId));
        const settings = t && (await settingsOf(orgId, t.test, v.timezone));
        if (!t || !settings?.window) return null;
        page = { ...t, settings: settings as Listed['settings'], state: 'live' };
      }
      if (!page) return null;
      const pools = testDrawPools(page.test, await data.questions.listQuestions(orgId, testId));
      return {
        ...summary(page),
        timezone: v.timezone,
        state: done && !listed ? 'finished' : page.state,
        questionCount: pools.reduce((n, p) => n + drawSize(p), 0),
        sections: page.test.sections.map((s) => {
          const pool = pools.find((p) => p.sectionId === s.id);
          return { name: s.name, questionCount: pool ? drawSize(pool) : 0 };
        }),
        marking: page.settings.marking,
        maxStrikes: page.settings.maxStrikes,
        exam: examEntrySchema.parse(page.settings),
      };
    },
  };

  async function testOf(orgId: string, testId: string) {
    const test = await data.tests.getTest(orgId, testId);
    if (!test) return null;
    const siblings = await data.tests.listTests(orgId, test.seriesId);
    return { test, dayLabel: dayLabels(siblings)[test.id] ?? null };
  }

  async function settingsOf(orgId: string, test: TestRecord, timezone: string): Promise<Settings | null> {
    if (test.resolved) return test.resolved;
    const series: SeriesRecord | null = await data.series.getSeries(orgId, test.seriesId);
    return series ? resolveSettings({ series, test, timezone }) : null;
  }
}
export type StudentTestsService = ReturnType<typeof studentTestsService>;
