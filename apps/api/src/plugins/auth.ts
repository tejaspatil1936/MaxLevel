import { claimsSchema, roleSchema, type FeatureFlag, type Role } from '@mitaoe/shared';
import type { Auth } from 'firebase-admin/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors';
import type { Data } from '../data';
import type { AccountStatusService } from '../services/account-status';
import type { EntitlementsService } from '../services/entitlements';

/**
 * Who may call a route (PLAN section 3). Every /v1 route declares one in its config. `adminOrStudent` serves one
 * resource to both sides (leaderboards): a student in their claim org, otherwise exactly as `admin`.
 */
export type Access = 'public' | 'signedIn' | 'superAdmin' | 'admin' | 'student' | 'device' | 'adminOrStudent';

export interface AuthUser {
  uid: string;
  email: string;
  role: Role | null;
  orgId: string | null;
  studentId: string | null;
  attemptId: string | null;
  /** Google confirmed the email address (bootstrap resolves roles only for verified Google accounts). */
  emailVerified: boolean;
  signInProvider: string | null;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
    /** Check token revocation; defaults to true for admin and super-admin writes (AUTH-05). */
    checkRevoked?: boolean;
    /** Feature flag the route belongs to; 403 FEATURE_DISABLED when it is off for the org (FF-02, ORG-13). */
    feature?: FeatureFlag;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Organization IDs are lowercase slugs (the seed and org creation use the same form). */
export const ORG_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Your sign-in has expired. Sign in again.');
const forbidden = () => new AppError(403, 'FORBIDDEN', 'Your account cannot use this.');

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
}

/**
 * Verifies the Firebase ID token on every non-public route (AUTH-05), reads role and orgId from its claims (ORG-02),
 * and enforces the route's access. Admin routes accept the org's admin, or a super admin naming the org in
 * X-Org-Id (ORG-11, API-04). Resources are then looked up under request.orgId only, so other orgs' records are 404.
 */
export function registerAuth(
  app: FastifyInstance,
  deps: { auth: Auth; data: Data; entitlements?: EntitlementsService; status?: AccountStatusService },
): void {
  app.addHook('onRequest', async (req) => {
    // Fail closed: a /v1 route that forgot to declare its access is treated as admin-only.
    const declared = req.routeOptions.config.access;
    const matched = req.routeOptions.url !== undefined;
    const access = declared ?? (matched && req.url.startsWith('/v1/') ? 'superAdmin' : 'public');
    if (access === 'public') return;

    const token = bearer(req);
    if (!token) throw unauthenticated();
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const checkRevoked =
      req.routeOptions.config.checkRevoked ??
      ((access === 'admin' || access === 'adminOrStudent' || access === 'superAdmin') && isWrite);
    let decoded;
    try {
      decoded = await deps.auth.verifyIdToken(token, checkRevoked);
    } catch {
      throw unauthenticated();
    }
    const parsed = claimsSchema.safeParse(decoded);
    const role = roleSchema.safeParse(decoded.role).success ? (decoded.role as Role) : null;
    const claims = parsed.success ? parsed.data : null;
    req.user = {
      uid: decoded.uid,
      email: (decoded.email ?? '').toLowerCase(),
      role,
      orgId: claims?.orgId ?? null,
      studentId: claims?.studentId ?? null,
      attemptId: claims?.attemptId ?? null,
      emailVerified: decoded.email_verified === true,
      signInProvider: decoded.firebase?.sign_in_provider ?? null,
    };
    const user = req.user;

    const effective = access === 'adminOrStudent' ? (user.role === 'student' ? 'student' : 'admin') : access;
    switch (effective) {
      case 'signedIn':
        return;
      case 'superAdmin':
        if (user.role !== 'superAdmin') throw forbidden();
        return;
      case 'student':
      case 'device':
        if (user.role !== effective || !user.orgId) throw forbidden();
        req.orgId = user.orgId;
        return;
      case 'admin': {
        if (user.role === 'admin' && user.orgId) {
          // An admin always acts in the org of their claim; X-Org-Id cannot move them elsewhere.
          req.orgId = user.orgId;
          return;
        }
        if (user.role === 'superAdmin') {
          const orgId = req.headers['x-org-id'];
          if (typeof orgId !== 'string' || !orgId) {
            throw new AppError(400, 'ORG_REQUIRED', 'Choose an organization to work in.', { header: 'X-Org-Id' });
          }
          // Only a plain org ID may reach a document path; anything else names no organization.
          if (!ORG_ID.test(orgId) || !(await deps.data.orgs.getOrg(orgId))) {
            throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
          }
          req.orgId = orgId;
          return;
        }
        throw forbidden();
      }
    }
  });

  // Account and org status (AUTH-06, ORG-07), then the feature gate (FF-02; super admins in the org's workspace as
  // well, ORG-13), once the org is known and before the request is validated: a refused caller learns nothing about
  // the body, and refusals come in the documented order (role, status, feature, then the body).
  app.addHook('preValidation', async (req) => {
    if (!deps.status || !req.user || !req.orgId) return;
    await deps.status.assert(req.user, req.orgId, !['GET', 'HEAD', 'OPTIONS'].includes(req.method));
  });

  app.addHook('preValidation', async (req) => {
    const feature = req.routeOptions.config.feature;
    if (!feature) return;
    if (!req.orgId || !deps.entitlements) throw forbidden();
    await deps.entitlements.requireFeature(req.orgId, feature);
  });
}
