import { boardResponseSchema, parseBoardId, resultsPublic } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors';
import type { ApiContext } from './context';
import { releaseInputOf } from './release';

const params = z.object({ boardId: z.string().min(1).max(140) });

const notAvailable = () => new AppError(404, 'LEADERBOARD_NOT_AVAILABLE', "This leaderboard isn't open to you.");

/**
 * GET /v1/leaderboards/{boardId}, the student side's open check (LB-04, RES-05): a board is closed to students unless
 * `public_leaderboards` is on (403 FEATURE_DISABLED), its leaderboard setting is on and the results are public
 * (released, not withdrawn, and in a flexible window only after its end). Serving the stored rows, the admin side and
 * the admission check arrive with F-4.05; until then an open board answers 501 NOT_IMPLEMENTED.
 */
export function leaderboardRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock } = ctx;

  async function open(orgId: string, boardId: string): Promise<boolean> {
    const board = parseBoardId(boardId);
    if (!board) return false;
    const now = clock.now();
    const isPublic = (t: Awaited<ReturnType<typeof data.tests.getTest>>) =>
      !!t?.resolved && resultsPublic(releaseInputOf({ ...t, resolved: t.resolved }), now);
    if (board.kind === 'test') {
      const test = await data.tests.getTest(orgId, board.refId);
      return !!test?.resolved?.testLeaderboard && isPublic(test);
    }
    const series = await data.series.getSeries(orgId, board.refId);
    if (!series?.defaults.seriesLeaderboard) return false;
    return (await data.tests.listTests(orgId, series.id)).some(isPublic);
  }

  return async (app) => {
    app.get(
      '/v1/leaderboards/:boardId',
      {
        config: { access: 'student' as const, feature: 'public_leaderboards' as const },
        schema: { params, response: { 200: boardResponseSchema } },
      },
      async (req) => {
        if (!(await open(req.orgId!, req.params.boardId))) throw notAvailable();
        throw new AppError(501, 'NOT_IMPLEMENTED', 'Leaderboards are not served yet.');
      },
    );
  };
}
