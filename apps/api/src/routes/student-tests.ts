import { studentDashboardSchema, studentTestPageSchema } from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import { studentTestsService } from '../services/student-tests';
import type { ApiContext } from './context';

const student = { access: 'student' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

const studentIdOf = (req: FastifyRequest) => {
  const id = req.user?.studentId;
  if (!id) throw new AppError(403, 'FORBIDDEN', 'Only students have tests to take.');
  return id;
};

/**
 * The student dashboard and test page (US-ST-03, UX-11): tests the student may sit, by the server clock, with times in
 * UTC ms and the organization's timezone to show them in. Staff tokens get 403; nothing carries an answer key (DATA-05).
 */
export function studentTestRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { clock } = ctx;
  const tests = studentTestsService(ctx.data);

  return async (app) => {
    app.get(
      '/v1/student/dashboard',
      { config: student, schema: { response: { 200: studentDashboardSchema } } },
      async (req) => tests.dashboard(req.orgId!, studentIdOf(req), clock.now()),
    );

    app.get(
      '/v1/student/tests/:id',
      { config: student, schema: { params: idParams, response: { 200: studentTestPageSchema } } },
      async (req) => {
        const page = await tests.testPage(req.orgId!, studentIdOf(req), req.params.id, clock.now());
        if (!page) throw notFound('Test');
        return page;
      },
    );
  };
}
