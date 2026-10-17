import { NOT_ON_LIST_MESSAGE, type BootstrapResponse, type Claims } from '@mitaoe/shared';
import type { Auth } from 'firebase-admin/auth';
import { AppError } from '../errors';
import type { Data } from '../data';

/**
 * Resolves who a signed-in Google account is (AUTH-02): the super-admin list, then admin records by email, then
 * whitelist entries by email. Sets the custom claims { role, orgId, studentId? } and links the uid to the record.
 * An email whitelisted in several orgs chooses one (AUTH-04).
 */
export async function bootstrapSession(
  deps: { auth: Auth; data: Data },
  user: { uid: string; email: string; emailVerified: boolean; signInProvider: string | null },
  chosenOrgId?: string,
): Promise<BootstrapResponse> {
  const { data } = deps;
  // Lists are keyed by email, so only an address Google has verified may claim a role (AUTH-01, AUTH-02).
  if (!user.email || !user.emailVerified || user.signInProvider !== 'google.com') {
    throw new AppError(403, 'NOT_ON_LIST', NOT_ON_LIST_MESSAGE);
  }

  const done = async (claims: Claims): Promise<BootstrapResponse> => {
    await setClaims(deps.auth, user.uid, claims);
    await data.identity.upsertUserIndex(user.uid, {
      role: claims.role,
      orgId: claims.orgId ?? null,
      studentId: claims.studentId ?? null,
      email: user.email,
    });
    return {
      status: 'ok',
      role: claims.role,
      orgId: claims.orgId ?? null,
      studentId: claims.studentId ?? null,
      refreshToken: true,
    };
  };

  const superAdmin = await data.identity.findSuperAdminByEmail(user.email);
  if (superAdmin) {
    if (superAdmin.uid !== user.uid) await data.identity.linkSuperAdminUid(superAdmin.id, user.uid);
    return done({ role: 'superAdmin' });
  }

  const orgIds = await data.identity.orgIdsForEmail(user.email);
  const orgs = await data.identity.orgSummaries(orgIds);
  const active = new Set(orgs.filter((o) => o.status === 'active').map((o) => o.id));
  type Pick<T> = { match: T } | { choose: BootstrapResponse } | null;
  const pick = <T extends { orgId: string }>(matches: T[]): Pick<T> => {
    const usable = matches.filter((m) => active.has(m.orgId));
    if (!usable.length) return null;
    if (chosenOrgId) {
      const chosen = usable.find((m) => m.orgId === chosenOrgId);
      if (!chosen) throw new AppError(404, 'NOT_FOUND', 'That organization is not available to this account.');
      return { match: chosen };
    }
    if (usable.length === 1) return { match: usable[0]! };
    return {
      choose: {
        status: 'choose_org',
        orgs: usable.map((m) => ({ orgId: m.orgId, name: orgs.find((o) => o.id === m.orgId)!.name })),
      },
    };
  };

  const adminPick = pick(await data.identity.findAdmins(user.email, orgIds));
  if (adminPick && 'choose' in adminPick) return adminPick.choose;
  if (adminPick) {
    const admin = adminPick.match;
    if (admin.uid !== user.uid) await data.admins.linkAdminUid(admin.orgId, admin.adminId, user.uid);
    return done({ role: 'admin', orgId: admin.orgId });
  }

  const entries = (await data.identity.findWhitelistEntries(user.email, orgIds)).filter((e) => e.status !== 'disabled');
  const entryPick = pick(entries);
  if (entryPick && 'choose' in entryPick) return entryPick.choose;
  if (entryPick) {
    const entry = entryPick.match;
    if (entry.studentId) await data.students.linkStudentUid(entry.orgId, entry.studentId, user.uid);
    return done({ role: 'student', orgId: entry.orgId, ...(entry.studentId ? { studentId: entry.studentId } : {}) });
  }

  if (orgIds.length && !active.size) {
    throw new AppError(403, 'ORG_SUSPENDED', 'Your organization is not available right now. Ask your placement cell.');
  }
  throw new AppError(403, 'NOT_ON_LIST', NOT_ON_LIST_MESSAGE);
}

async function setClaims(auth: Auth, uid: string, claims: Claims): Promise<void> {
  const current = (await auth.getUser(uid)).customClaims ?? {};
  const same = ['role', 'orgId', 'studentId', 'attemptId'].every((k) => current[k] === claims[k as keyof Claims]);
  if (!same) await auth.setCustomUserClaims(uid, claims);
}
