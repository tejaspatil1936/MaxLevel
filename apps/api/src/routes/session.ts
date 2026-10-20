import { bootstrapRequestSchema, bootstrapResponseSchema, meResponseSchema, NOT_ON_LIST_MESSAGE } from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Data } from '../data';
import type { Deps } from '../deps';
import type { EntitlementsService } from '../services/entitlements';
import { AppError } from '../errors';
import { bootstrapSession } from '../services/bootstrap';

export function sessionRoutes(deps: Deps & { data: Data; entitlements: EntitlementsService }): FastifyPluginAsyncZod {
  const effective = async (orgId: string) => {
    const e = await deps.entitlements.get(orgId);
    return e ? { features: e.features, limits: e.limits } : null;
  };
  const studentComplete = async (orgId: string | null, studentId: string | null) => {
    if (!orgId || !studentId) return false;
    const s = await deps.data.students.getStudent(orgId, studentId);
    return !!s?.consentAt && !!s.name && !!s.prn && !!s.departmentId && !!s.graduationYear;
  };
  return async (app) => {
    app.post(
      '/v1/session/bootstrap',
      {
        config: { access: 'signedIn' },
        schema: { body: bootstrapRequestSchema, response: { 200: bootstrapResponseSchema } },
      },
      async (req) =>
        bootstrapSession(
          { auth: deps.firebase.auth, data: deps.data, db: deps.firebase.db, now: deps.clock.now() },
          req.user!,
          req.body.orgId,
        ),
    );

    app.get(
      '/v1/me',
      { config: { access: 'signedIn' }, schema: { response: { 200: meResponseSchema } } },
      async (req) => {
        const u = req.user!;
        if (!u.role) throw new AppError(403, 'NOT_ON_LIST', NOT_ON_LIST_MESSAGE);
        return {
          uid: u.uid,
          email: u.email,
          role: u.role,
          orgId: u.orgId,
          studentId: u.studentId,
          org: u.orgId ? await deps.data.orgs.getOrg(u.orgId) : null,
          entitlements: u.orgId ? await effective(u.orgId) : null,
          preferences: await deps.data.preferences.getPreferences(u),
          profileComplete: u.role !== 'student' ? true : await studentComplete(u.orgId, u.studentId),
          canSwitchOrg: u.role === 'student' && (await deps.data.identity.orgIdsForEmail(u.email)).length > 1,
        };
      },
    );
  };
}
