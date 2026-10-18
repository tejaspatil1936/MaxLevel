import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  profileSchema,
  studentProfileSchema,
  type StudentProfile,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors';
import type { ApiContext } from './context';

/** The signed-in student's profile (STU-01 to STU-03, SEC-08) and every account's preferences (A11Y-02). */
export function meRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, status } = ctx;
  const db = ctx.firebase.db;

  const profileOf = async (req: FastifyRequest): Promise<StudentProfile> => {
    const orgId = req.orgId!;
    const u = req.user!;
    const [entry, org, depts] = await Promise.all([
      data.whitelist.getWhitelistEntry(orgId, u.email),
      data.orgs.getOrgRecord(orgId),
      data.departments.listDepartments(orgId),
    ]);
    const studentId = u.studentId ?? entry?.studentId ?? null;
    const s = studentId ? await data.students.getStudent(orgId, studentId) : null;
    const complete = !!s && !!s.consentAt;
    return {
      studentId: s?.id ?? null,
      name: s?.name ?? null,
      prn: s?.prn ?? entry?.prn ?? null,
      departmentId: s?.departmentId ?? null,
      graduationYear: s?.graduationYear ?? null,
      prnLocked: !!entry?.prn,
      editingLocked: complete && !!org?.profileLocked,
      complete,
      consentGiven: !!s?.consentAt,
      departments: depts
        .filter((d) => d.status === 'active' || d.id === s?.departmentId)
        .map((d) => ({ id: d.id, name: d.name })),
    };
  };

  return async (app) => {
    app.get(
      '/v1/me/profile',
      { config: { access: 'student' }, schema: { response: { 200: studentProfileSchema } } },
      async (req) => profileOf(req),
    );

    app.put(
      '/v1/me/profile',
      { config: { access: 'student' }, schema: { body: profileSchema, response: { 200: studentProfileSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const u = req.user!;
        const current = await profileOf(req);
        const b = req.body;
        if (current.editingLocked)
          throw new AppError(403, 'PROFILE_LOCKED', 'Your profile is locked. Ask your placement cell to change it.');
        if (!current.consentGiven && b.consent !== true) {
          throw new AppError(400, 'VALIDATION', 'Agree to the data notice to continue.', { field: 'consent' });
        }
        if (current.prnLocked && current.prn && b.prn !== current.prn) {
          throw new AppError(400, 'VALIDATION', 'Your PRN comes from your placement cell and cannot be changed here.', {
            field: 'prn',
          });
        }
        const other = await data.students.findStudentByPrn(orgId, b.prn);
        if (other && other.id !== current.studentId)
          throw new AppError(
            409,
            'PRN_TAKEN',
            'Another student in your college already uses this PRN. Check it, or ask your placement cell.',
            { field: 'prn' },
          );
        const dept = current.departments.find((d) => d.id === b.departmentId);
        if (!dept)
          throw new AppError(400, 'VALIDATION', 'Choose your department from the list.', { field: 'departmentId' });

        const now = clock.now();
        const batch = db.batch();
        let studentId = current.studentId;
        const fields = { name: b.name, prn: b.prn, departmentId: b.departmentId, graduationYear: b.graduationYear };
        if (!studentId) {
          // DATA-01: the record (and its studentId) is created at profile completion for whitelisted students.
          studentId = data.students.createStudent(orgId, batch, {
            uid: u.uid,
            email: u.email,
            ...fields,
            status: 'registered',
            consentAt: now,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          data.students.updateStudent(orgId, batch, studentId, {
            ...fields,
            uid: u.uid,
            status: 'registered',
            updatedAt: now,
            ...(current.consentGiven ? {} : { consentAt: now }),
          });
        }
        data.whitelist.updateWhitelistEntry(orgId, batch, u.email, { status: 'registered', studentId, prn: b.prn });
        await batch.commit();
        if (u.studentId !== studentId)
          await ctx.firebase.auth.setCustomUserClaims(u.uid, { role: 'student', orgId, studentId });
        status.invalidate();
        return profileOf(Object.assign(req, { user: { ...u, studentId } }));
      },
    );

    app.put(
      '/v1/me/preferences',
      { config: { access: 'signedIn' }, schema: { body: preferencesSchema, response: { 200: preferencesSchema } } },
      async (req) => {
        await data.preferences.setPreferences(req.user!.uid, req.body);
        return req.body;
      },
    );

    app.get(
      '/v1/me/preferences',
      { config: { access: 'signedIn' }, schema: { response: { 200: preferencesSchema } } },
      async (req) => (req.user ? data.preferences.getPreferences(req.user.uid) : DEFAULT_PREFERENCES),
    );
  };
}
