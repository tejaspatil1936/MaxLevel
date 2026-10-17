import type { Firestore } from 'firebase-admin/firestore';

export function studentsData(db: Firestore) {
  return {
    async linkStudentUid(orgId: string, studentId: string, uid: string): Promise<void> {
      await db.doc(`organizations/${orgId}/students/${studentId}`).update({ uid });
    },
  };
}
