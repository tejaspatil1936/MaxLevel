import {
  FINISHED_ATTEMPT_STATUSES,
  isEligible,
  leaderboardPages,
  NO_RESTRICTION,
  type EligibilityRules,
  type EligibilityStudent,
  type PrewarmTarget,
  type AnswerRecord,
  type AttemptEventDetails,
  type AttemptRecord,
  type ProctorEventType,
  type GradingQuestion,
  type RankableAttempt,
  type Section,
  type Settings,
  type StrikeVerdict,
  withSnapshotFallbacks,
} from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

// The worker's data access (ORG-03: every function takes orgId first). It reads and writes the same records as the
// API's data layer (apps/api/src/data), only those its tasks need.

/** What finishing an attempt stores (EX-17); a termination also says why (PR-10). */
export type FinishedFields = Required<Pick<AttemptRecord, 'status' | 'submittedAt' | 'result'>> &
  Pick<AttemptRecord, 'terminationReason'>;

/** What recording a strike the worker decided did: the attempt as it now stands and the stored event's number. */
export interface RecordedStrike {
  attempt: AttemptRecord;
  verdict: StrikeVerdict;
  /** The stored event's strike number, when it counted (now or on an earlier run of the same task). */
  strikeNumber?: number;
  /** The event was already stored by an earlier run: nothing new was written. */
  repeat: boolean;
}

/** What the release task reads of a test: its settings snapshot and release state (RES-01). */
export interface ReleaseTest {
  id: string;
  seriesId: string;
  resolved: Settings;
  resultsReleasedAt: number | null;
  resultsWithdrawn: boolean;
}

const toReleaseTest = (d: DocumentSnapshot): ReleaseTest => ({
  id: d.id,
  seriesId: d.get('seriesId') as string,
  resolved: withSnapshotFallbacks(d.get('resolved') as Settings),
  resultsReleasedAt: typeof d.get('resultsReleasedAt') === 'number' ? (d.get('resultsReleasedAt') as number) : null,
  resultsWithdrawn: d.get('resultsWithdrawn') === true,
});

/** What grading needs of a test: its sections (section marks) and its published settings snapshot. */
export interface GradedTest {
  id: string;
  seriesId: string;
  sections: Section[];
  resolved: Settings;
}

const toAttempt = (d: DocumentSnapshot): AttemptRecord => {
  const { orgId, ...rest } = d.data() ?? {};
  return {
    ...(rest as Omit<AttemptRecord, 'id' | 'orgId'>),
    id: d.id,
    orgId: orgId as string,
    questionServedAt: rest.questionServedAt ?? {},
    strikesCount: rest.strikesCount ?? 0,
    extraTimeSec: rest.extraTimeSec ?? 0,
  };
};

/** A stored leaderboard row (spec 10.1); series rows also keep each test's counted score. */
export interface StoredBoardRow {
  studentId: string;
  name: string;
  departmentId: string;
  score: number;
  rank: number;
  timeSec: number;
  scores?: Record<string, number | null>;
}

const FINISHED: ReadonlySet<string> = new Set(FINISHED_ATTEMPT_STATUSES);

export function workerData(db: Firestore) {
  const org = (orgId: string) => db.doc(`organizations/${orgId}`);

  return {
    async getAttempt(orgId: string, attemptId: string): Promise<AttemptRecord | null> {
      const d = await org(orgId).collection('attempts').doc(attemptId).get();
      return d.exists ? toAttempt(d) : null;
    },

    /** A published test (one with a settings snapshot), or null. */
    async getGradedTest(orgId: string, testId: string): Promise<GradedTest | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      if (!d.exists || !d.get('resolved')) return null;
      return {
        id: d.id,
        seriesId: d.get('seriesId') as string,
        sections: (d.get('sections') as Section[] | undefined) ?? [],
        resolved: withSnapshotFallbacks(d.get('resolved') as Settings),
      };
    },

    /** A published test's release state, or null for a missing or unpublished test. */
    async getReleaseTest(orgId: string, testId: string): Promise<ReleaseTest | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      return d.exists && d.get('resolved') ? toReleaseTest(d) : null;
    },

    /** DATA-05, OPS-06: the status and deadline of a test's attempts still in progress (the release task waits). */
    async listAnsweringAttempts(orgId: string, testId: string): Promise<Array<{ status: string; deadlineAt: number }>> {
      const snap = await org(orgId)
        .collection('attempts')
        .where('testId', '==', testId)
        .where('status', '==', 'in_progress')
        .select('status', 'deadlineAt')
        .get();
      return snap.docs.map((d) => ({ status: d.get('status') as string, deadlineAt: d.get('deadlineAt') as number }));
    },

    /**
     * RES-01, REL-04: stores `resultsReleasedAt` in a transaction when `decide` still says so on the stored test, so a
     * Release or Withdraw results racing the task is never overwritten. True when it stored.
     */
    async releaseByTask(
      orgId: string,
      testId: string,
      decide: (test: ReleaseTest) => boolean,
      now: number,
    ): Promise<boolean> {
      const ref = org(orgId).collection('tests').doc(testId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || !snap.get('resolved') || !decide(toReleaseTest(snap))) return false;
        tx.update(ref, { resultsReleasedAt: now });
        return true;
      });
    },

    /** LB-02: the published tests of a series with their release state. */
    async listSeriesReleaseTests(orgId: string, seriesId: string): Promise<ReleaseTest[]> {
      const snap = await org(orgId).collection('tests').where('seriesId', '==', seriesId).get();
      return snap.docs.filter((d) => d.get('resolved')).map(toReleaseTest);
    },

    /**
     * LB-01: the finished attempts of a test (`submitted`, `auto_submitted`, `terminated`) with the student's name and
     * department, as ranking reads them. Ranking itself leaves terminated attempts out.
     */
    async listRankableAttempts(orgId: string, testId: string): Promise<RankableAttempt[]> {
      const snap = await org(orgId)
        .collection('attempts')
        .where('testId', '==', testId)
        .select('studentId', 'status', 'result.score', 'result.durationSec', 'submittedAt', 'startedAt')
        .get();
      const done = snap.docs.filter(
        (d) => FINISHED.has(d.get('status') as string) && d.get('result.score') !== undefined,
      );
      const ids = [...new Set(done.map((d) => d.get('studentId') as string))];
      const students = ids.length ? await db.getAll(...ids.map((id) => org(orgId).collection('students').doc(id))) : [];
      const who = new Map(students.map((d) => [d.id, d]));
      return done.map((d) => {
        const studentId = d.get('studentId') as string;
        const student = who.get(studentId);
        return {
          studentId,
          name: (student?.get('name') as string | null | undefined) ?? '',
          departmentId: (student?.get('departmentId') as string | null | undefined) ?? '',
          status: d.get('status') as RankableAttempt['status'],
          score: d.get('result.score') as number,
          timeSec: (d.get('result.durationSec') as number | undefined) ?? 0,
          submittedAt: (d.get('submittedAt') as number | undefined) ?? (d.get('startedAt') as number | undefined) ?? 0,
        };
      });
    },

    /**
     * LB-03, DATA-04: stores a board as `leaderboards/{boardId}` with `computedAt`, `total` and its first page of rows;
     * a board above one page (`leaderboardPages`: 5,000 rows or about 900 KB) keeps further pages in
     * `leaderboards/{boardId}/pages/{n}` (n from 1), and pages left over from a larger board are deleted. One batch, so
     * readers never see a half-written board.
     */
    async putLeaderboard(orgId: string, boardId: string, computedAt: number, rows: StoredBoardRow[]): Promise<void> {
      const ref = org(orgId).collection('leaderboards').doc(boardId);
      const pages = leaderboardPages(rows);
      const before = ((await ref.get()).get('pageCount') as number | undefined) ?? 1;
      const batch = db.batch();
      batch.set(ref, { computedAt, total: rows.length, pageCount: pages.length, rows: pages[0] });
      pages.slice(1).forEach((page, i) => batch.set(ref.collection('pages').doc(String(i + 1)), { rows: page }));
      for (let n = pages.length; n < before; n++) batch.delete(ref.collection('pages').doc(String(n)));
      await batch.commit();
    },

    /** The answer key and own marks of the named questions of a test (EX-17); missing questions are left out. */
    async answerKeys(orgId: string, testId: string, questionIds: string[]): Promise<Map<string, GradingQuestion>> {
      const col = org(orgId).collection('tests').doc(testId).collection('questions');
      const docs = questionIds.length ? await db.getAll(...questionIds.map((id) => col.doc(id))) : [];
      return new Map(
        docs
          .filter((d) => d.exists)
          .map((d) => {
            const marks = d.get('marks') as number | undefined;
            const negativeMarks = d.get('negativeMarks') as number | undefined;
            return [
              d.id,
              {
                correctOptionIds: (d.get('correctOptionIds') as string[] | undefined) ?? [],
                ...(marks !== undefined ? { marks } : {}),
                ...(negativeMarks !== undefined ? { negativeMarks } : {}),
              },
            ];
          }),
      );
    },

    /**
     * PR-07, PR-08, PR-11, REL-04: logs a strike event the worker decided and counts it in one transaction, as the
     * API's recordEvent does, under a fixed event ID: a task run again finds its event and changes nothing. `decide`
     * sees the attempt as stored. `ATTEMPT_FINISHED` (nothing stored) once it is not in progress; null when missing.
     */
    async recordServerStrike(
      orgId: string,
      attemptId: string,
      event: { id: string; type: ProctorEventType; details: AttemptEventDetails; serverTs: number },
      decide: (attempt: AttemptRecord) => StrikeVerdict,
    ): Promise<RecordedStrike | 'ATTEMPT_FINISHED' | null> {
      const ref = org(orgId).collection('attempts').doc(attemptId);
      const eventRef = ref.collection('events').doc(event.id);
      return db.runTransaction(async (tx) => {
        const [snap, stored] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
        if (!snap.exists) return null;
        const attempt = toAttempt(snap);
        if (stored.exists) {
          const strikeNumber = stored.get('strikeNumber') as number | undefined;
          const verdict: StrikeVerdict = { counted: false, terminates: false };
          return { attempt, verdict, repeat: true, ...(strikeNumber !== undefined ? { strikeNumber } : {}) };
        }
        if (attempt.status !== 'in_progress') return 'ATTEMPT_FINISHED';
        const verdict = decide(attempt);
        const strikeNumber = verdict.counted ? verdict.strikeNumber : undefined;
        tx.create(eventRef, {
          orgId,
          type: event.type,
          details: event.details,
          clientTs: event.serverTs,
          serverTs: event.serverTs,
          ...(strikeNumber !== undefined ? { strikeNumber } : {}),
        });
        if (strikeNumber === undefined) return { attempt, verdict, repeat: false };
        tx.update(ref, { strikesCount: strikeNumber, lastStrikeAt: event.serverTs });
        return {
          attempt: { ...attempt, strikesCount: strikeNumber, lastStrikeAt: event.serverTs },
          verdict,
          strikeNumber,
          repeat: false,
        };
      });
    },

    /**
     * EX-16, REL-04: finishes an attempt at most once. In one transaction the attempt and its answers are read; an
     * attempt still in progress gets what `finish` builds, unless `finish` returns null (for example, the deadline
     * moved). Null when there is no attempt.
     */
    async finalizeAttempt(
      orgId: string,
      attemptId: string,
      finish: (attempt: AttemptRecord, answers: Record<string, AnswerRecord>) => FinishedFields | null,
    ): Promise<{ attempt: AttemptRecord; finalized: boolean } | null> {
      const ref = org(orgId).collection('attempts').doc(attemptId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const attempt = toAttempt(snap);
        if (attempt.status !== 'in_progress') return { attempt, finalized: false };
        // Each drawn question's answer by reference, so an answer save racing this transaction conflicts with it.
        const ids = attempt.draw.questionIds;
        const answers = ids.length ? await tx.getAll(...ids.map((id) => ref.collection('answers').doc(id))) : [];
        const fields = finish(
          attempt,
          Object.fromEntries(answers.flatMap((d) => (d.exists ? [[d.id, d.data() as AnswerRecord]] : []))),
        );
        if (!fields) return { attempt, finalized: false };
        tx.update(ref, fields);
        return { attempt: { ...attempt, ...fields }, finalized: true };
      });
    },

    /** PERF-06: what a pre-warm run reads of a test (status, settings snapshot window, last pre-warm), or null. */
    async getPrewarmTarget(orgId: string, testId: string): Promise<PrewarmTarget | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      if (!d.exists) return null;
      const resolved = d.get('resolved') as Settings | undefined;
      const prewarmedFor = d.get('prewarmedFor') as unknown;
      return {
        status: d.get('status') as string,
        window: resolved?.window ?? null,
        prewarmedFor: typeof prewarmedFor === 'number' ? prewarmedFor : null,
      };
    },

    /** PERF-06, SER-04 to SER-06: the registered students the test's series and test rules admit. */
    async countEligibleStudents(orgId: string, testId: string): Promise<number> {
      const test = await org(orgId).collection('tests').doc(testId).get();
      const rules = (r: unknown): EligibilityRules => ({ ...NO_RESTRICTION, ...(r as Partial<EligibilityRules>) });
      const series = await org(orgId)
        .collection('series')
        .doc(String(test.get('seriesId')))
        .get();
      const students = await org(orgId).collection('students').where('status', '==', 'registered').get();
      return students.docs.filter((s) =>
        isEligible(
          {
            id: s.id,
            status: 'registered',
            departmentId: (s.get('departmentId') as EligibilityStudent['departmentId']) ?? null,
            graduationYear: (s.get('graduationYear') as EligibilityStudent['graduationYear']) ?? null,
          },
          rules(series.get('eligibility')),
          rules(test.get('eligibility')),
        ),
      ).length;
    },

    /** REL-04: records the slot a pre-warm ran for, so a retry of the same task calls the scaler no more. */
    async markPrewarmed(orgId: string, testId: string, windowStart: number, now: number): Promise<void> {
      await org(orgId).collection('tests').doc(testId).update({ prewarmedFor: windowStart, prewarmedAt: now });
    },
  };
}
export type WorkerData = ReturnType<typeof workerData>;
