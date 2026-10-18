import {
  boardResponse,
  boardResponseSchema,
  dayLabels,
  isEligible,
  parseBoardId,
  resultsPublic,
  testBoardTitle,
  type BoardKind,
  type BoardResponse,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SeriesRecord } from '../data/series';
import type { TestRecord } from '../data/tests';
import { AppError, notFound } from '../errors';
import { asEligibility } from '../services/eligibility';
import { studentOf } from './attempts';
import type { ApiContext } from './context';
import { releaseInputOf } from './release';

const params = z.object({ boardId: z.string().min(1).max(140) });

const notAvailable = () => new AppError(404, 'LEADERBOARD_NOT_AVAILABLE', "This leaderboard isn't open to you.");

/** A board's test or series with what the response and the open check need. */
export interface BoardSubject {
  boardId: string;
  kind: BoardKind;
  title: string;
  max?: number;
  series: SeriesRecord;
  /** Test boards: the test. Series boards: undefined. */
  test?: TestRecord;
  /** The series' tests (the open check of a series board reads their release state). */
  tests: TestRecord[];
}

/**
 * Board subjects and the student open check (LB-04), shared by the board and the student's list of open boards. A
 * board is open to a student when its leaderboard setting is on, the results are public (released, not withdrawn,
 * and in a flexible window only after its end; a series board needs one such test), and the series (and, for a test
 * board, the test) admits the student or the student has a finished attempt on it. `public_leaderboards` is checked
 * by the route's feature gate.
 */
export function leaderboardAccess(ctx: Pick<ApiContext, 'data' | 'clock'>) {
  const { data, clock } = ctx;
  const isPublic = (t: TestRecord, now: number) =>
    !!t.resolved && resultsPublic(releaseInputOf({ ...t, resolved: t.resolved }), now);

  function subjects(series: SeriesRecord, tests: TestRecord[]): BoardSubject[] {
    const labels = dayLabels(tests);
    return [
      { boardId: `series_${series.id}`, kind: 'series' as const, title: series.title, series, tests },
      ...tests.map((test) => ({
        boardId: `test_${test.id}`,
        kind: 'test' as const,
        title: testBoardTitle(test.title, labels[test.id] ?? null),
        max: test.totalMarks,
        series,
        test,
        tests,
      })),
    ];
  }

  return {
    subjects,

    /** The board's test or series in the org, or null (also for another org's board, ORG-05). */
    async subject(orgId: string, boardId: string): Promise<BoardSubject | null> {
      const board = parseBoardId(boardId);
      if (!board) return null;
      const test = board.kind === 'test' ? await data.tests.getTest(orgId, board.refId) : null;
      if (board.kind === 'test' && !test) return null;
      const series = await data.series.getSeries(orgId, test ? test.seriesId : board.refId);
      if (!series) return null;
      const tests = await data.tests.listTests(orgId, series.id);
      return subjects(series, tests).find((s) => s.boardId === boardId) ?? null;
    },

    /** LB-04: whether the student may open the board. `attempted` holds the tests of their finished attempts. */
    async openTo(
      orgId: string,
      s: BoardSubject,
      student: { id: string; attempted: ReadonlySet<string> },
    ): Promise<boolean> {
      const now = clock.now();
      if (s.test) {
        if (!s.test.resolved?.testLeaderboard || !isPublic(s.test, now)) return false;
      } else if (!s.series.defaults.seriesLeaderboard || !s.tests.some((t) => isPublic(t, now))) return false;
      const own = s.test ? [s.test] : s.tests;
      if (own.some((t) => student.attempted.has(t.id))) return true;
      const record = await data.students.getStudent(orgId, student.id);
      return !!record && isEligible(asEligibility(record), s.series.eligibility, s.test?.eligibility);
    },

    /** The tests of the student's finished attempts. */
    async attempted(orgId: string, studentId: string): Promise<Set<string>> {
      return new Set((await data.attempts.listFinishedAttempts(orgId, studentId)).map((a) => a.testId));
    },
  };
}

/**
 * GET /v1/leaderboards/{boardId} (LB-04, LB-05, US-ST-09, RES-05): the stored board. An admin of the org, or a super
 * admin with X-Org-Id, gets every row of any board of the org (404 for another org's); a student only a board open to
 * them (else 404 LEADERBOARD_NOT_AVAILABLE), with the first 50 rows and their own row. With `public_leaderboards` off
 * everyone gets 403 FEATURE_DISABLED (FF-02).
 */
export function leaderboardRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data } = ctx;
  const access = leaderboardAccess(ctx);

  return async (app) => {
    app.get(
      '/v1/leaderboards/:boardId',
      {
        config: { access: 'adminOrStudent' as const, feature: 'public_leaderboards' as const },
        schema: { params, response: { 200: boardResponseSchema } },
      },
      async (req): Promise<BoardResponse> => {
        const orgId = req.orgId!;
        const studentId = req.user?.role === 'student' ? studentOf(req).studentId : null;
        const subject = await access.subject(orgId, req.params.boardId);
        if (!subject) throw studentId ? notAvailable() : notFound('Leaderboard');
        if (studentId) {
          const attempted = await access.attempted(orgId, studentId);
          if (!(await access.openTo(orgId, subject, { id: studentId, attempted }))) throw notAvailable();
        }
        const [board, departments] = await Promise.all([
          data.leaderboards.getLeaderboard(orgId, subject.boardId),
          data.departments.departmentNames(orgId),
        ]);
        const { boardId, kind, title, max } = subject;
        return boardResponse({
          boardId,
          kind,
          title,
          ...(max !== undefined ? { max } : {}),
          board,
          departments,
          studentId,
        });
      },
    );
  };
}
