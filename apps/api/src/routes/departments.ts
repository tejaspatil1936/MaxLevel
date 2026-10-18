import { departmentCreateSchema, departmentMergeSchema, departmentPatchSchema, departmentSchema } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

/** Department list per organization (STU-05 to STU-07). Students store departmentId, so renames apply everywhere. */
export function departmentRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock } = ctx;
  const db = ctx.firebase.db;
  const one = async (orgId: string, id: string) =>
    (await data.departments.listDepartments(orgId)).find((d) => d.id === id) ?? null;

  return async (app) => {
    app.get(
      '/v1/departments',
      { config: admin, schema: { response: { 200: z.object({ items: z.array(departmentSchema) }) } } },
      async (req) => ({
        items: await data.departments.listDepartments(req.orgId!),
      }),
    );

    app.post(
      '/v1/departments',
      { config: admin, schema: { body: departmentCreateSchema, response: { 201: departmentSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        if (await data.departments.findDepartmentByName(orgId, req.body.name)) {
          throw new AppError(409, 'DEPARTMENT_EXISTS', 'A department with this name already exists.', {
            field: 'name',
          });
        }
        const batch = db.batch();
        const id = data.departments.createDepartment(orgId, batch, req.body.name);
        audit(req, batch, { action: 'department.create', target: { type: 'department', id }, after: req.body });
        await batch.commit();
        return reply.status(201).send((await one(orgId, id))!);
      },
    );

    app.patch(
      '/v1/departments/:id',
      { config: admin, schema: { params: idParams, body: departmentPatchSchema, response: { 200: departmentSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.departments.getDepartment(orgId, req.params.id);
        if (!before) throw notFound('Department');
        if (req.body.name) {
          const clash = await data.departments.findDepartmentByName(orgId, req.body.name);
          if (clash && clash !== before.id)
            throw new AppError(409, 'DEPARTMENT_EXISTS', 'A department with this name already exists.', {
              field: 'name',
            });
        }
        const batch = db.batch();
        data.departments.updateDepartment(orgId, batch, before.id, req.body);
        const statusChange = req.body.status && req.body.status !== before.status;
        audit(req, batch, {
          action: statusChange
            ? req.body.status === 'archived'
              ? 'department.archive'
              : 'department.restore'
            : 'department.update',
          target: { type: 'department', id: before.id },
          before,
          after: req.body,
        });
        await batch.commit();
        return (await one(orgId, before.id))!;
      },
    );

    // STU-07: a department in use is merged into another, never deleted.
    app.post(
      '/v1/departments/:id/merge',
      {
        config: admin,
        schema: {
          params: idParams,
          body: departmentMergeSchema,
          response: { 200: z.object({ moved: z.number().int(), into: departmentSchema }) },
        },
      },
      async (req) => {
        const orgId = req.orgId!;
        const [from, into] = await Promise.all([
          data.departments.getDepartment(orgId, req.params.id),
          data.departments.getDepartment(orgId, req.body.intoId),
        ]);
        if (!from || !into) throw notFound('Department');
        if (from.id === into.id)
          throw new AppError(400, 'VALIDATION', 'Choose a different department to merge into.', { field: 'intoId' });
        const students = await data.departments.studentIdsInDepartment(orgId, from.id);
        const now = clock.now();
        for (let i = 0; i < students.length; i += 400) {
          const batch = db.batch();
          for (const s of students.slice(i, i + 400)) data.students.setDepartmentOf(orgId, batch, s, into.id, now);
          await batch.commit();
        }
        const batch = db.batch();
        data.departments.updateDepartment(orgId, batch, from.id, { status: 'archived' });
        audit(req, batch, {
          action: 'department.merge',
          target: { type: 'department', id: from.id },
          before: from,
          after: { mergedInto: into.id, studentsMoved: students.length },
        });
        await batch.commit();
        return { moved: students.length, into: (await one(orgId, into.id))! };
      },
    );

    app.delete(
      '/v1/departments/:id',
      { config: admin, schema: { params: idParams, response: { 200: z.object({ deleted: z.literal(true) }) } } },
      async (req) => {
        const orgId = req.orgId!;
        const dept = await data.departments.getDepartment(orgId, req.params.id);
        if (!dept) throw notFound('Department');
        const inUse = (await data.departments.studentIdsInDepartment(orgId, dept.id)).length;
        if (inUse) {
          throw new AppError(
            409,
            'DEPARTMENT_IN_USE',
            `${inUse} students are in this department. Merge it into another one or archive it instead.`,
            { students: inUse },
          );
        }
        const batch = db.batch();
        data.departments.deleteDepartment(orgId, batch, dept.id);
        audit(req, batch, { action: 'department.delete', target: { type: 'department', id: dept.id }, before: dept });
        await batch.commit();
        return { deleted: true as const };
      },
    );
  };
}
