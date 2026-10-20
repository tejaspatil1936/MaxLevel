import type { OrgAdmin } from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { emailKey, normalizeEmail } from './keys';
import { writer, type Tx } from './tx';

export interface AdminRecord extends OrgAdmin {
  uid: string | null;
}

export function adminsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/admins`);
  const toAdmin = (d: FirebaseFirestore.DocumentSnapshot): AdminRecord => ({
    id: d.id,
    email: d.get('email'),
    name: d.get('name') ?? null,
    status: d.get('status'),
    uid: d.get('uid') ?? null,
    signedIn: !!d.get('uid'),
    addedAt: d.get('addedAt') ?? 0,
  });
  return {
    async linkAdminUid(orgId: string, adminId: string, uid: string): Promise<void> {
      await col(orgId).doc(adminId).update({ uid });
    },

    async listAdmins(orgId: string): Promise<AdminRecord[]> {
      return (await col(orgId).where('status', '==', 'active').get()).docs
        .map(toAdmin)
        .sort((a, b) => a.email.localeCompare(b.email));
    },

    async getAdmin(orgId: string, adminId: string): Promise<AdminRecord | null> {
      const d = await col(orgId).doc(adminId).get();
      return d.exists ? toAdmin(d) : null;
    },

    async findAdminByUid(orgId: string, uid: string): Promise<AdminRecord | null> {
      const snap = await col(orgId).where('uid', '==', uid).limit(1).get();
      return snap.docs[0] ? toAdmin(snap.docs[0]) : null;
    },

    async findActiveAdminByEmail(orgId: string, email: string): Promise<AdminRecord | null> {
      const snap = await col(orgId)
        .where('email', '==', normalizeEmail(email))
        .where('status', '==', 'active')
        .limit(1)
        .get();
      return snap.docs[0] ? toAdmin(snap.docs[0]) : null;
    },

    addAdmin(orgId: string, tx: Tx, input: { email: string; name?: string; addedBy: string; addedAt: number }): string {
      const ref = col(orgId).doc();
      const email = normalizeEmail(input.email);
      writer(tx).create(ref, {
        orgId,
        email,
        name: input.name ?? null,
        status: 'active',
        addedBy: input.addedBy,
        addedAt: input.addedAt,
      });
      writer(tx).set(
        db.doc(`emailIndex/${emailKey(email)}`),
        { orgIds: FieldValue.arrayUnion(orgId) },
        { merge: true },
      );
      return ref.id;
    },

    removeAdmin(orgId: string, tx: Tx, adminId: string): void {
      writer(tx).update(col(orgId).doc(adminId), { status: 'removed' });
    },
  };
}
