import { NOT_ON_LIST_MESSAGE, type BootstrapResponse, type Claims } from '@mitaoe/shared';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../errors';
import type { Data } from '../data';

/**
 * Resolves who a signed-in Google account is (AUTH-02): the super-admin list, then admin records by email, then
 * whitelist entries by email. Sets the custom claims { role, orgId, studentId? } and links the uid to the record.
 * An email whitelisted in several orgs chooses one (AUTH-04).
 */
export async function bootstrapSession(
  deps: { auth: Auth; data: Data; db: Firestore; now: number },
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

  // Until the user picks, no org is active: old claims must not keep them in the previously chosen org.
  const choose = async (res: BootstrapResponse) => {
    await deps.auth.setCustomUserClaims(user.uid, null);
    return res;
  };

  const adminPick = pick(await data.identity.findAdmins(user.email, orgIds));
  if (adminPick && 'choose' in adminPick) return choose(adminPick.choose);
  if (adminPick) {
    const admin = adminPick.match;
    if (admin.uid !== user.uid) await data.admins.linkAdminUid(admin.orgId, admin.adminId, user.uid);
    return done({ role: 'admin', orgId: admin.orgId });
  }

  const entries = (await data.identity.findWhitelistEntries(user.email, orgIds)).filter((e) => e.status !== 'disabled');
  const entryPick = pick(entries);
  if (entryPick && 'choose' in entryPick) return choose(entryPick.choose);
  if (entryPick) {
    const entry = entryPick.match;
    let studentId = entry.studentId;
    if (studentId) await data.students.linkStudentUid(entry.orgId, studentId, user.uid);
    else {
      // DATA-01: a whitelisted student's record (and studentId) is created at first sign-in; the profile comes next.
      const batch = deps.db.batch();
      studentId = data.students.createStudent(entry.orgId, batch, {
        uid: user.uid,
        email: user.email,
        name: null,
        prn: entry.prn,
        departmentId: null,
        graduationYear: null,
        status: 'invited',
        consentAt: null,
        createdAt: deps.now,
        updatedAt: deps.now,
      });
      data.whitelist.updateWhitelistEntry(entry.orgId, batch, user.email, { studentId });
      await batch.commit();
    }
    return done({ role: 'student', orgId: entry.orgId, studentId });
  }

  if (orgIds.length && !active.size) {
    const archived = orgs.length > 0 && orgs.every((o) => o.status === 'archived');
    throw archived
      ? new AppError(
          403,
          'ORG_ARCHIVED',
          "This organization is archived, so you can't sign in. Ask your placement cell for help.",
        )
      : new AppError(
          403,
          'ORG_SUSPENDED',
          "This organization is suspended, so you can't sign in. Ask your placement cell for help.",
        );
  }
  throw new AppError(403, 'NOT_ON_LIST', NOT_ON_LIST_MESSAGE);
}

async function setClaims(auth: Auth, uid: string, claims: Claims): Promise<void> {
  const current = (await auth.getUser(uid)).customClaims ?? {};
  const same = ['role', 'orgId', 'studentId', 'attemptId'].every((k) => current[k] === claims[k as keyof Claims]);
  if (!same) await auth.setCustomUserClaims(uid, claims);
}
