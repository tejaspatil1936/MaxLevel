import type { OrgDetail, OrgSettingsPatch, OrgSummary } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import type { Tx } from './audit';

export function orgsData(db: Firestore) {
  return {
    async getOrg(orgId: string): Promise<OrgSummary | null> {
      const s = await db.doc(`organizations/${orgId}`).get();
      if (!s.exists) return null;
      return {
        id: s.id,
        name: s.get('name'),
        slug: s.get('slug'),
        timezone: s.get('timezone'),
        status: s.get('status'),
      };
    },

    async getOrgDetail(orgId: string): Promise<OrgDetail | null> {
      const s = await db.doc(`organizations/${orgId}`).get();
      if (!s.exists) return null;
      return {
        id: s.id,
        name: s.get('name'),
        slug: s.get('slug'),
        timezone: s.get('timezone'),
        status: s.get('status'),
        profileLocked: s.get('profileLocked') === true,
      };
    },

    updateOrgSettings(orgId: string, tx: Tx, patch: OrgSettingsPatch): void {
      (tx as FirebaseFirestore.WriteBatch).update(db.doc(`organizations/${orgId}`), { ...patch });
    },
  };
}
