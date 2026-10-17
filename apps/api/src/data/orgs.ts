import type { OrgSummary } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

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

    async getOrgs(orgIds: string[]): Promise<OrgSummary[]> {
      const all = await Promise.all(orgIds.map((id) => this.getOrg(id)));
      return all.filter((o): o is OrgSummary => o !== null);
    },
  };
}
