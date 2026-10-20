import type { OrgSummary } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { emailKey, normalizeEmail } from './keys';

// Bootstrap lookups by email. Exempt from the orgId-first rule (ORG-03): they run before the org is known,
// and read only the email index and the records it points to.

export interface SuperAdminMatch {
  id: string;
  uid: string | null;
}
export interface AdminMatch {
  orgId: string;
  adminId: string;
  uid: string | null;
}
export interface WhitelistMatch {
  orgId: string;
  status: 'invited' | 'registered' | 'disabled';
  studentId: string | null;
  prn: string | null;
}

export function identityData(db: Firestore) {
  return {
    async findSuperAdminByEmail(email: string): Promise<SuperAdminMatch | null> {
      const snap = await db.collection('superAdmins').where('email', '==', normalizeEmail(email)).limit(1).get();
      const doc = snap.docs[0];
      return doc ? { id: doc.id, uid: (doc.get('uid') as string | null) ?? null } : null;
    },

    async orgIdsForEmail(email: string): Promise<string[]> {
      const snap = await db.doc(`emailIndex/${emailKey(email)}`).get();
      return (snap.get('orgIds') as string[] | undefined) ?? [];
    },

    async findAdmins(email: string, orgIds: string[]): Promise<AdminMatch[]> {
      const found = await Promise.all(
        orgIds.map(async (orgId) => {
          const snap = await db
            .collection(`organizations/${orgId}/admins`)
            .where('email', '==', normalizeEmail(email))
            .where('status', '==', 'active')
            .limit(1)
            .get();
          const doc = snap.docs[0];
          return doc ? { orgId, adminId: doc.id, uid: (doc.get('uid') as string | null) ?? null } : null;
        }),
      );
      return found.filter((m): m is AdminMatch => m !== null);
    },

    async findWhitelistEntries(email: string, orgIds: string[]): Promise<WhitelistMatch[]> {
      const snaps = await Promise.all(
        orgIds.map((orgId) => db.doc(`organizations/${orgId}/whitelist/${emailKey(email)}`).get()),
      );
      return snaps.flatMap((s, i) =>
        s.exists
          ? [
              {
                orgId: orgIds[i]!,
                status: s.get('status') as WhitelistMatch['status'],
                studentId: (s.get('studentId') as string | null) ?? null,
                prn: (s.get('prn') as string | null) ?? null,
              },
            ]
          : [],
      );
    },

    /** Summaries of the orgs an email belongs to, for the org choice at sign-in. */
    async orgSummaries(orgIds: string[]): Promise<OrgSummary[]> {
      const snaps = await Promise.all(orgIds.map((id) => db.doc(`organizations/${id}`).get()));
      return snaps
        .filter((s) => s.exists)
        .map((s) => ({
          id: s.id,
          name: s.get('name'),
          slug: s.get('slug'),
          timezone: s.get('timezone'),
          status: s.get('status'),
        }));
    },

    async linkSuperAdminUid(id: string, uid: string): Promise<void> {
      await db.doc(`superAdmins/${id}`).update({ uid });
    },

    async upsertUserIndex(
      uid: string,
      entry: { role: string; orgId: string | null; studentId: string | null; email: string },
    ): Promise<void> {
      await db.doc(`userIndex/${uid}`).set({ ...entry, email: normalizeEmail(entry.email) });
    },
  };
}
