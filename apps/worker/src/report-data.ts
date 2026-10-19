import {
  dayLabels,
  isEligible,
  NO_RESTRICTION,
  testBoardTitle,
  type AttemptResult,
  type EligibilityRules,
  type EligibilityStudent,
  type MetricsAttempt,
  type ReportError,
  type ReportMetrics,
  type ReportScope,
  type ReportStatus,
  type SummaryStatus,
} from '@mitaoe/shared';
import { FieldValue, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';

// What the report task reads and writes (EXP-04 to EXP-06; ORG-03: every function takes orgId first): the report
// record the API stored, held by one run at a time under a lease, and the stored data its metrics are computed from.

export interface ReportRecord {
  id: string;
  orgId: string;
  scope: ReportScope;
  refId: string;
  title: string;
  status: ReportStatus;
  includeXlsx: boolean;
  createdAt: number;
  metrics?: ReportMetrics;
  summaryCalls?: number;
  /** Answers rejected by the number check so far, and the unsupported numbers they used. */
  rejections?: number;
  rejectedNumbers?: string[];
  /** Model failures in a row (REL-06). */
  failures?: number;
  tokens?: { input: number; output: number };
  /** The summary as decided before the print: an accepted answer is kept, so a later run asks the model nothing. */
  summaryStatus?: SummaryStatus;
  summary?: string | null;
  recommendations?: string[];
}

/** What a run may write on the report it holds; `null` removes a field, except `summary`, stored as null. */
export type ReportUpdate = Partial<{
  status: ReportStatus;
  metrics: ReportMetrics;
  summary: string | null;
  recommendations: string[];
  summaryStatus: SummaryStatus;
  summaryCalls: number;
  rejections: number;
  rejectedNumbers: string[];
  failures: number;
  error: ReportError | null;
  retryAt: number | null;
  provider: string;
  model: string;
  tokens: { input: number; output: number };
  pdfPath: string;
  xlsxPath: string;
  finishedAt: number;
  leaseUntil: number | null;
}>;

export type ReportClaim =
  | { kind: 'claimed'; report: ReportRecord }
  /** Missing, ready or failed: nothing to do (REL-04). */
  | { kind: 'done' }
  /** Waiting for its retry time. */
  | { kind: 'waiting'; retryAt: number }
  /** Another run holds it until then. */
  | { kind: 'held'; heldUntil: number };

/** The run no longer holds the report (its lease ran out and another run took it): it writes nothing more. */
export class ReportLeaseLost extends Error {
  constructor() {
    super('Another run holds this report.');
    this.name = 'ReportLeaseLost';
  }
}

/** The test inputs of `computeTestMetrics`, as stored. */
export interface TestMetricsInputs {
  maxScore: number;
  eligible: number;
  inProgress: number;
  questions: Array<{
    id: string;
    sectionId: string | null;
    options: Array<{ id: string; text: string }>;
    correctOptionIds: string[];
  }>;
  sections: Array<{ id: string; name: string; max: number }>;
  departments: Array<{ id: string; name: string }>;
  attempts: MetricsAttempt[];
}

/** The series inputs of `computeSeriesMetrics`, as stored. */
export interface SeriesMetricsInputs {
  eligible: number;
  departments: Array<{ id: string; name: string }>;
  tests: Array<{
    id: string;
    heading: string;
    scheduledDate: string;
    windowStart: number;
    maxScore: number;
    attempts: MetricsAttempt[];
  }>;
}

const FINISHED: ReadonlySet<string> = new Set(['submitted', 'auto_submitted', 'terminated']);
const rules = (r: unknown): EligibilityRules => ({ ...NO_RESTRICTION, ...(r as Partial<EligibilityRules>) });
const CHUNK = 25;

export function reportData(db: Firestore) {
  const org = (orgId: string) => db.doc(`organizations/${orgId}`);
  const reportRef = (orgId: string, reportId: string) => org(orgId).collection('reports').doc(reportId);

  const fields = (u: ReportUpdate) =>
    Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v === null && k !== 'summary' ? FieldValue.delete() : v]));

  /** Registered students the rules admit (SER-04 to SER-06), with their departments. */
  async function students(orgId: string) {
    const snap = await org(orgId).collection('students').where('status', '==', 'registered').get();
    return snap.docs.map((d) => ({
      id: d.id,
      status: 'registered' as const,
      departmentId: (d.get('departmentId') as EligibilityStudent['departmentId']) ?? null,
      graduationYear: (d.get('graduationYear') as EligibilityStudent['graduationYear']) ?? null,
    }));
  }

  /** Departments by name, the organization's order (as the API lists them). */
  async function departments(orgId: string) {
    const snap = await org(orgId).collection('departments').get();
    return snap.docs
      .map((d) => ({ id: d.id, name: (d.get('name') as string | undefined) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every attempt of a test with the student's department; `withAnswers` reads the finished ones' answers too. */
  async function attemptsOf(
    orgId: string,
    testId: string,
    departmentOf: Map<string, string | null>,
    withAnswers = true,
  ) {
    const snap = await org(orgId).collection('attempts').where('testId', '==', testId).get();
    const finished = snap.docs.filter((d) => FINISHED.has(d.get('status') as string));
    const attempts: MetricsAttempt[] = [];
    for (let i = 0; i < finished.length; i += CHUNK)
      attempts.push(...(await Promise.all(finished.slice(i, i + CHUNK).map((d) => toMetrics(d, withAnswers)))));
    // Each section's maximum, from the stored results (a pool draws the same marks for everyone).
    const sectionMax = new Map<string, number>();
    for (const d of finished)
      for (const [id, s] of Object.entries((d.get('result') as AttemptResult | undefined)?.sections ?? {}))
        sectionMax.set(id, Math.max(sectionMax.get(id) ?? 0, s.max));
    return {
      inProgress: snap.docs.filter((d) => d.get('status') === 'in_progress').length,
      attempts: attempts.map((a) => ({ ...a, departmentId: departmentOf.get(a.studentId) ?? null })),
      sectionMax,
    };
  }

  async function toMetrics(d: DocumentSnapshot, withAnswers: boolean): Promise<MetricsAttempt> {
    const result = d.get('result') as AttemptResult | undefined;
    const drawn = ((d.get('draw.questionIds') as string[] | undefined) ?? []).slice();
    const answers: Record<string, string | null> = {};
    if (withAnswers) {
      for (const id of drawn) answers[id] = null;
      for (const a of (await d.ref.collection('answers').get()).docs)
        if (a.id in answers) answers[a.id] = (a.get('optionId') as string | null | undefined) ?? null;
    }
    return {
      studentId: d.get('studentId') as string,
      departmentId: null,
      status: d.get('status') as MetricsAttempt['status'],
      score: result?.score ?? 0,
      durationSec: result?.durationSec ?? 0,
      strikesCount: (d.get('strikesCount') as number | undefined) ?? 0,
      sections: Object.fromEntries(Object.entries(result?.sections ?? {}).map(([k, s]) => [k, { score: s.score }])),
      answers,
      drawQuestionIds: withAnswers ? drawn : [],
    };
  }

  return {
    /**
     * REL-04, REL-06: moves a queued report, a retrying one at its `retryAt`, or a running one whose lease ran out,
     * to `running` held by `runId` until `leaseUntil`; anything else is left as it is.
     */
    async claim(
      orgId: string,
      reportId: string,
      run: { runId: string; now: number; leaseUntil: number },
    ): Promise<ReportClaim> {
      const ref = reportRef(orgId, reportId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const status = snap.get('status') as ReportStatus | undefined;
        if (!snap.exists || status === 'ready' || status === 'failed' || status === undefined) return { kind: 'done' };
        const retryAt = snap.get('retryAt') as number | undefined;
        if (status === 'retrying' && typeof retryAt === 'number' && retryAt > run.now)
          return { kind: 'waiting', retryAt };
        const leaseUntil = snap.get('leaseUntil') as number | undefined;
        if (status === 'running' && typeof leaseUntil === 'number' && leaseUntil > run.now)
          return { kind: 'held', heldUntil: leaseUntil };
        tx.update(ref, { status: 'running', runId: run.runId, leaseUntil: run.leaseUntil });
        const report = { ...(snap.data() as Omit<ReportRecord, 'id'>), id: snap.id, status: 'running' as const };
        return { kind: 'claimed', report };
      });
    },

    /** Writes on the report while `runId` holds it; ReportLeaseLost, writing nothing, once it does not. */
    async update(orgId: string, reportId: string, runId: string, u: ReportUpdate): Promise<void> {
      const ref = reportRef(orgId, reportId);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).get('runId') !== runId) throw new ReportLeaseLost();
        tx.update(ref, fields(u));
      });
    },

    /** The organization's name and timezone, for the PDF. */
    async orgInfo(orgId: string): Promise<{ name: string; timezone: string }> {
      const d = await org(orgId).get();
      return {
        name: (d.get('name') as string | undefined) ?? '',
        timezone: (d.get('timezone') as string | undefined) ?? 'Asia/Kolkata',
      };
    },

    /** EXP-04: what a test's metrics are computed from; null for a test that is missing or not published. */
    async testInputs(orgId: string, testId: string): Promise<TestMetricsInputs | null> {
      const test = await org(orgId).collection('tests').doc(testId).get();
      if (!test.exists || !test.get('resolved')) return null;
      const [series, everyone, depts, questions] = await Promise.all([
        org(orgId)
          .collection('series')
          .doc(String(test.get('seriesId')))
          .get(),
        students(orgId),
        departments(orgId),
        test.ref.collection('questions').where('status', '==', 'approved').get(),
      ]);
      const { inProgress, attempts, sectionMax } = await attemptsOf(
        orgId,
        testId,
        new Map(everyone.map((s) => [s.id, s.departmentId])),
      );
      const sectionList = ((test.get('sections') as Array<{ id: string; name: string; order?: number }>) ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return {
        maxScore: (test.get('totalMarks') as number | undefined) ?? 0,
        eligible: everyone.filter((s) =>
          isEligible(s, rules(series.get('eligibility')), rules(test.get('eligibility'))),
        ).length,
        inProgress,
        questions: questions.docs
          .sort((a, b) => ((a.get('order') as number) ?? 0) - ((b.get('order') as number) ?? 0))
          .map((q) => ({
            id: q.id,
            sectionId: (q.get('sectionId') as string | null | undefined) ?? null,
            options: ((q.get('options') as Array<{ id: string; text: string }> | undefined) ?? []).map((o) => ({
              id: o.id,
              text: o.text,
            })),
            correctOptionIds: (q.get('correctOptionIds') as string[] | undefined) ?? [],
          })),
        sections: sectionList.map((s) => ({ id: s.id, name: s.name, max: sectionMax.get(s.id) ?? 0 })),
        departments: depts,
        attempts,
      };
    },

    /** EXP-04: what a series' metrics are computed from: its published tests; null for a missing series. */
    async seriesInputs(orgId: string, seriesId: string): Promise<SeriesMetricsInputs | null> {
      const series = await org(orgId).collection('series').doc(seriesId).get();
      if (!series.exists) return null;
      const [everyone, depts, testSnap] = await Promise.all([
        students(orgId),
        departments(orgId),
        org(orgId).collection('tests').where('seriesId', '==', seriesId).get(),
      ]);
      const all = testSnap.docs
        .map((d) => ({
          d,
          id: d.id,
          title: (d.get('title') as string | undefined) ?? '',
          scheduledDate: (d.get('scheduledDate') as string | undefined) ?? '',
          dayNumber: (d.get('dayNumber') as string | null | undefined) ?? null,
          dayHidden: d.get('dayHidden') === true,
          createdAt: (d.get('createdAt') as number | undefined) ?? 0,
        }))
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt - b.createdAt);
      const labels = dayLabels(all);
      const departmentOf = new Map(everyone.map((s) => [s.id, s.departmentId]));
      const published = all.filter((t) => t.d.get('resolved'));
      const tests = await Promise.all(
        published.map(async (t) => ({
          id: t.id,
          heading: testBoardTitle(t.title, labels[t.id] ?? null),
          scheduledDate: t.scheduledDate,
          windowStart: (t.d.get('resolved.window.start') as number | undefined) ?? 0,
          maxScore: (t.d.get('totalMarks') as number | undefined) ?? 0,
          attempts: (await attemptsOf(orgId, t.id, departmentOf, false)).attempts,
        })),
      );
      return {
        eligible: everyone.filter((s) => isEligible(s, rules(series.get('eligibility')))).length,
        departments: depts,
        tests,
      };
    },
  };
}
export type ReportData = ReturnType<typeof reportData>;
