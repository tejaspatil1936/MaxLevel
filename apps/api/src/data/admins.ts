import type { Firestore } from 'firebase-admin/firestore';

export function adminsData(db: Firestore) {
  return {
    async linkAdminUid(orgId: string, adminId: string, uid: string): Promise<void> {
      await db.doc(`organizations/${orgId}/admins/${adminId}`).update({ uid });
    },
  };
}
