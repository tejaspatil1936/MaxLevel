import {
  pageOf,
  studentCreateSchema,
  studentListQuerySchema,
  studentPatchSchema,
  studentSchema,
  auditEntrySchema,
  type Student,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pageItems } from '../data/page';
import type { StudentRecord } from '../data/students';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });

const attemptSummarySchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  status: z.string(),
  score: z.number().nullable(),
  max: z.number().nullable(),
  strikes: z.number().int(),
  startedAt: z.number(),
});
const studentDetailSchema = z.object({
  student: studentSchema,
  attempts: z.array(attemptSummarySchema),
  history: z.array(auditEntrySchema),
});

/** Student directory, detail, edits and manual adds (STU-08 to STU-11, US-AD-02). */
export function studentRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, entitlements, status } = ctx;
  const db = ctx.firebase.db;

  const withDepartments = async (orgId: string, list: StudentRecord[]): Promise<Student[]> => {
    const depts = new Map((await data.departments.listDepartments(orgId)).map((d) => [d.id, d.name]));
    return list.map(({ consentAt: _c, ...s }) => ({ ...s, departmentName: depts.get(s.departmentId) ?? '' }));
  };
  const prnFree = async (orgId: string, prn: string, self?: string) => {
    const other = await data.students.findStudentByPrn(orgId, prn);
    if (other && other.id !== self)
      throw new AppError(409, 'PRN_TAKEN', 'Another student in this organization already has this PRN.', {
        field: 'prn',
      });
  };
  const departmentExists = async (orgId: string, id: string) => {
    const d = await data.departments.getDepartment(orgId, id);
    if (!d || d.status !== 'active')
      throw new AppError(400, 'VALIDATION', 'Choose a department from the list.', { field: 'departmentId' });
  };

  return async (app) => {
    app.get(
      '/v1/students',
      { config: admin, schema: { querystring: studentListQuerySchema, response: { 200: pageOf(studentSchema) } } },
      async (req) => {
        const { cursor, limit, q, departmentId, graduationYear, status: st, sort, dir } = req.query;
        const orgId = req.orgId!;
        let list = await withDepartments(
          orgId,
          await data.students.listStudents(orgId, {
            ...(departmentId ? { departmentId } : {}),
            ...(graduationYear ? { graduationYear } : {}),
            ...(st ? { status: st } : {}),
          }),
        );
        if (q) {
          const n = q.toLowerCase();
          list = list.filter(
            (s) => s.name.toLowerCase().includes(n) || s.email.includes(n) || s.prn.toLowerCase().includes(n),
          );
        }
        const key = sort === 'department' ? 'departmentName' : sort;
        const sign = dir === 'desc' ? -1 : 1;
        list.sort((a, b) => {
          const x = a[key as keyof Student];
          const y = b[key as keyof Student];
          return (
            sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) ||
            a.id.localeCompare(b.id)
          );
        });
        return pageItems(list, cursor, limit);
      },
    );

    // STU-09: a manual add creates the whitelist entry and the profile together; status stays invited until sign-in.
    app.post(
      '/v1/students',
      { config: admin, schema: { body: studentCreateSchema, response: { 201: studentSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        const b = req.body;
        if (await data.whitelist.getWhitelistEntry(orgId, b.email))
          throw new AppError(409, 'EMAIL_EXISTS', 'This email is already on the whitelist.', { field: 'email' });
        await prnFree(orgId, b.prn);
        await departmentExists(orgId, b.departmentId);
        const [count, ent] = await Promise.all([data.whitelist.countWhitelist(orgId), entitlements.get(orgId)]);
        if (count >= ent!.limits.max_students) {
          throw new AppError(
            403,
            'LIMIT_REACHED',
            `The list already holds the limit of ${ent!.limits.max_students} students.`,
            { limit: 'max_students' },
          );
        }
        const now = clock.now();
        const batch = db.batch();
        const id = data.students.createStudent(orgId, batch, {
          uid: null,
          email: b.email,
          name: b.name,
          prn: b.prn,
          departmentId: b.departmentId,
          graduationYear: b.graduationYear,
          status: 'invited',
          consentAt: null,
          createdAt: now,
          updatedAt: now,
        });
        data.whitelist.putWhitelistEntry(orgId, batch, {
          email: b.email,
          prn: b.prn,
          note: b.note ?? null,
          status: 'invited',
          studentId: id,
          source: 'manual',
          addedBy: req.user!.uid,
          addedAt: now,
        });
        audit(req, batch, { action: 'student.create', target: { type: 'student', id }, after: b });
        await batch.commit();
        const [created] = await withDepartments(orgId, [(await data.students.getStudent(orgId, id))!]);
        return reply.status(201).send(created!);
      },
    );

    // STU-10: profile, every attempt with score and strikes, and the audit trail of changes to this student.
    app.get(
      '/v1/students/:id',
      { config: admin, schema: { params: idParams, response: { 200: studentDetailSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const s = await data.students.getStudent(orgId, req.params.id);
        if (!s) throw notFound('Student');
        const [student] = await withDepartments(orgId, [s]);
        const history = await data.audit.listAudit(orgId, { target: s.id });
        return { student: student!, attempts: [], history };
      },
    );

    app.patch(
      '/v1/students/:id',
      { config: admin, schema: { params: idParams, body: studentPatchSchema, response: { 200: studentSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.students.getStudent(orgId, req.params.id);
        if (!before) throw notFound('Student');
        const patch = req.body;
        if (patch.prn) await prnFree(orgId, patch.prn, before.id);
        if (patch.departmentId) await departmentExists(orgId, patch.departmentId);
        const batch = db.batch();
        data.students.updateStudent(orgId, batch, before.id, { ...patch, updatedAt: clock.now() });
        if (patch.status || patch.prn) {
          data.whitelist.updateWhitelistEntry(orgId, batch, before.email, {
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.prn ? { prn: patch.prn } : {}),
          });
        }
        const action =
          patch.status === 'disabled'
            ? 'student.disable'
            : patch.status && before.status === 'disabled'
              ? 'student.enable'
              : 'student.update';
        const { consentAt: _c, ...beforeView } = before;
        audit(req, batch, {
          action,
          target: { type: 'student', id: before.id },
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, beforeView[k as keyof typeof beforeView]])),
          after: patch,
        });
        await batch.commit();
        if (patch.status === 'disabled' && before.uid) await ctx.firebase.auth.revokeRefreshTokens(before.uid);
        status.invalidate();
        const [after] = await withDepartments(orgId, [(await data.students.getStudent(orgId, before.id))!]);
        return after!;
      },
    );

    // US-AD-02: deleting removes the profile and the whitelist entry; attempts and results stay, keyed by studentId.
    app.delete(
      '/v1/students/:id',
      { config: admin, schema: { params: idParams, response: { 200: z.object({ deleted: z.literal(true) }) } } },
      async (req) => {
        const orgId = req.orgId!;
        const s = await data.students.getStudent(orgId, req.params.id);
        if (!s) throw notFound('Student');
        const batch = db.batch();
        data.students.deleteStudent(orgId, batch, s.id);
        data.whitelist.removeWhitelistEntry(orgId, batch, s.email, false);
        const { consentAt: _c, ...view } = s;
        audit(req, batch, { action: 'student.delete', target: { type: 'student', id: s.id }, before: view });
        await batch.commit();
        if (s.uid) await ctx.firebase.auth.revokeRefreshTokens(s.uid);
        status.invalidate();
        return { deleted: true as const };
      },
    );
  };
}
