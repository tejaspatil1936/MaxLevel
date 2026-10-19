import { accommodationSchema, accommodationsSchema } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const params = z.object({ id: z.string().min(1).max(128), seriesId: z.string().min(1).max(128) });
const response = { 200: z.object({ accommodations: accommodationsSchema }) };
const ACTION = 'student.accommodation.update';

/**
 * Standing accommodations (OPS-07, A11Y-17): an admin of the student's organization, or a super admin working in it
 * (ORG-11, ORG-14), sets or removes a student's extra time for a series. A student or series of another organization
 * is 404 (ORG-05). The audit entry is written in the same batch as the change (AUD-02). Attempts take it when they
 * start; attempts already started keep their deadline.
 */
export function accommodationRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit } = ctx;
  const db = ctx.firebase.db;

  return async (app) => {
    /** PUT /v1/students/{id}/accommodations/{seriesId}: `{ extraPct }` or `{ extraMin }`, replacing any earlier one. */
    app.put(
      '/v1/students/:id/accommodations/:seriesId',
      { config: admin, schema: { params, body: accommodationSchema, response } },
      async (req) => {
        const orgId = req.orgId!;
        const { id, seriesId } = req.params;
        const [student, series] = await Promise.all([
          data.students.getStudent(orgId, id),
          data.series.getSeries(orgId, seriesId),
        ]);
        if (!student) throw notFound('Student');
        if (!series) throw notFound('Series');
        const before = student.accommodations[seriesId];
        const batch = db.batch();
        data.students.setAccommodation(orgId, batch, id, seriesId, req.body);
        audit(req, batch, {
          action: ACTION,
          target: { type: 'student', id },
          ...(before ? { before: { seriesId, ...before } } : {}),
          after: { seriesId, ...req.body },
        });
        await batch.commit();
        return { accommodations: { ...student.accommodations, [seriesId]: req.body } };
      },
    );

    /** DELETE /v1/students/{id}/accommodations/{seriesId}: removes it; with none stored nothing is written. */
    app.delete(
      '/v1/students/:id/accommodations/:seriesId',
      { config: admin, schema: { params, response } },
      async (req) => {
        const orgId = req.orgId!;
        const { id, seriesId } = req.params;
        const student = await data.students.getStudent(orgId, id);
        if (!student) throw notFound('Student');
        const { [seriesId]: before, ...rest } = student.accommodations;
        if (before) {
          const batch = db.batch();
          data.students.setAccommodation(orgId, batch, id, seriesId, null);
          audit(req, batch, {
            action: ACTION,
            target: { type: 'student', id },
            before: { seriesId, ...before },
            after: { seriesId, removed: true },
          });
          await batch.commit();
        }
        return { accommodations: rest };
      },
    );
  };
}
