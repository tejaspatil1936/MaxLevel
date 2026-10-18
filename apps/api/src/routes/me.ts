import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  profileSchema,
  studentProfileSchema,
  type StudentProfile,
} from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { StudentRecord } from '../data/students';
import { AppError, notFound } from '../errors';
import type { ApiContext } from './context';

const hasProfile = (s: StudentRecord | null) => !!s && !!s.name && !!s.prn && !!s.departmentId && !!s.graduationYear;

/**
 * The signed-in student's consent (SEC-08) and profile (STU-01 to STU-03), and every account's preferences (A11Y-02).
 * The student record exists from first sign-in (bootstrap); consent and the profile complete it.
 */
export function meRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, clock, status } = ctx;
  const db = ctx.firebase.db;

  const load = async (req: FastifyRequest) => {
    const orgId = req.orgId!;
    const u = req.user!;
    const [entry, org, depts] = await Promise.all([
      data.whitelist.getWhitelistEntry(orgId, u.email),
      data.orgs.getOrgRecord(orgId),
      data.departments.listDepartments(orgId),
    ]);
    const studentId = u.studentId ?? entry?.studentId ?? null;
    const student = studentId ? await data.students.getStudent(orgId, studentId) : null;
    if (!student)
      throw new AppError(
        403,
        'NOT_ON_LIST',
        "This Google account isn't on any organization's list. Ask your placement cell to add it.",
      );
    const complete = !!student.consentAt && hasProfile(student);
    const profile: StudentProfile = {
      studentId: student.id,
      name: student.name,
      prn: student.prn ?? entry?.prn ?? null,
      departmentId: student.departmentId,
      graduationYear: student.graduationYear,
      prnLocked: !!entry?.prn,
      editingLocked: complete && !!org?.profileLocked,
      complete,
      consentGiven: !!student.consentAt,
      departments: depts.filter((d) => d.status === 'active').map((d) => ({ id: d.id, name: d.name })),
    };
    return { orgId, user: u, entry, student, profile };
  };

  return async (app) => {
    app.get(
      '/v1/me/profile',
      { config: { access: 'student' }, schema: { response: { 200: studentProfileSchema } } },
      async (req) => (await load(req)).profile,
    );

    // SEC-08: the consent notice on first sign-in. A record that already holds the whole profile (manual add) is
    // registered at once.
    app.post(
      '/v1/me/consent',
      {
        config: { access: 'student' },
        schema: { body: z.object({}).strict().default({}), response: { 200: studentProfileSchema } },
      },
      async (req) => {
        const { orgId, user, student, profile } = await load(req);
        if (profile.consentGiven) return profile;
        const now = clock.now();
        const batch = db.batch();
        const registered = hasProfile(student);
        data.students.updateStudent(orgId, batch, student.id, {
          consentAt: now,
          uid: user.uid,
          updatedAt: now,
          ...(registered ? { status: 'registered' } : {}),
        });
        if (registered) data.whitelist.updateWhitelistEntry(orgId, batch, user.email, { status: 'registered' });
        await batch.commit();
        status.invalidate();
        return (await load(req)).profile;
      },
    );

    app.put(
      '/v1/me/profile',
      { config: { access: 'student' }, schema: { body: profileSchema, response: { 200: studentProfileSchema } } },
      async (req) => {
        const { orgId, user, student, profile } = await load(req);
        const b = req.body;
        if (profile.editingLocked)
          throw new AppError(403, 'PROFILE_LOCKED', 'Your profile is locked. Ask your placement cell to make changes.');
        if (!profile.consentGiven)
          throw new AppError(409, 'CONSENT_REQUIRED', 'Read and agree to the data notice first.');
        if (profile.prnLocked && profile.prn && b.prn !== profile.prn) {
          throw new AppError(400, 'VALIDATION', 'Your PRN comes from your placement cell and cannot be changed here.', {
            field: 'prn',
          });
        }
        const other = await data.students.findStudentByPrn(orgId, b.prn, student.id);
        if (other && other.id !== student.id) {
          throw new AppError(
            409,
            'PRN_TAKEN',
            'This PRN is already registered. Check it, or ask your placement cell for help.',
            { field: 'prn' },
          );
        }
        if (!profile.departments.some((d) => d.id === b.departmentId)) {
          throw new AppError(400, 'VALIDATION', 'Choose your department from the list.', { field: 'departmentId' });
        }
        const now = clock.now();
        const batch = db.batch();
        data.students.updateStudent(orgId, batch, student.id, {
          ...b,
          uid: user.uid,
          status: 'registered',
          updatedAt: now,
        });
        data.whitelist.updateWhitelistEntry(orgId, batch, user.email, {
          status: 'registered',
          studentId: student.id,
          prn: b.prn,
        });
        await batch.commit();
        status.invalidate();
        return (await load(req)).profile;
      },
    );

    app.put(
      '/v1/me/preferences',
      { config: { access: 'signedIn' }, schema: { body: preferencesSchema, response: { 200: preferencesSchema } } },
      async (req) => {
        if (!(await data.preferences.setPreferences(req.user!, req.body))) throw notFound('Student');
        return req.body;
      },
    );

    app.get(
      '/v1/me/preferences',
      { config: { access: 'signedIn' }, schema: { response: { 200: preferencesSchema } } },
      async (req) => (req.user ? data.preferences.getPreferences(req.user) : DEFAULT_PREFERENCES),
    );
  };
}
