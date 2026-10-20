import type { FeatureMap, LimitMap, OrgDetail, OrgSettingsPatch, OrgSummary } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { toMillis } from './keys';
import { writer, type Tx } from './tx';

export interface OrgRecord extends OrgSummary {
  logoPath: string | null;
  planId: string;
  featureOverrides: FeatureMap;
  limitOverrides: LimitMap;
  profileLocked: boolean;
  createdAt: number;
}

export const toOrgRecord = (s: FirebaseFirestore.DocumentSnapshot): OrgRecord => ({
  id: s.id,
  name: s.get('name'),
  slug: s.get('slug'),
  timezone: s.get('timezone'),
  status: s.get('status'),
  logoPath: s.get('logoPath') ?? null,
  planId: s.get('planId') ?? 'standard',
  featureOverrides: s.get('featureOverrides') ?? {},
  limitOverrides: s.get('limitOverrides') ?? {},
  profileLocked: s.get('profileLocked') === true,
  createdAt: toMillis(s.get('createdAt')),
});

export function orgsData(db: Firestore) {
  const ref = (orgId: string) => db.doc(`organizations/${orgId}`);
  return {
    async getOrg(orgId: string): Promise<OrgSummary | null> {
      const s = await ref(orgId).get();
      if (!s.exists) return null;
      const r = toOrgRecord(s);
      return { id: r.id, name: r.name, slug: r.slug, timezone: r.timezone, status: r.status };
    },

    async getOrgRecord(orgId: string): Promise<OrgRecord | null> {
      const s = await ref(orgId).get();
      return s.exists ? toOrgRecord(s) : null;
    },

    async getOrgDetail(orgId: string): Promise<OrgDetail | null> {
      const s = await ref(orgId).get();
      if (!s.exists) return null;
      const r = toOrgRecord(s);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        timezone: r.timezone,
        status: r.status,
        profileLocked: r.profileLocked,
      };
    },

    updateOrgSettings(orgId: string, tx: Tx, patch: OrgSettingsPatch): void {
      writer(tx).update(ref(orgId), { ...patch });
    },

    createOrg(
      orgId: string,
      tx: Tx,
      input: { name: string; slug: string; timezone: string; logoPath: string | null; createdAt: number },
    ): void {
      writer(tx).create(ref(orgId), {
        orgId,
        ...input,
        status: 'active',
        planId: 'standard',
        featureOverrides: {},
        limitOverrides: {},
        profileLocked: false,
      });
    },

    updateOrg(
      orgId: string,
      tx: Tx,
      patch: Partial<Pick<OrgRecord, 'name' | 'timezone' | 'status' | 'logoPath'>>,
    ): void {
      writer(tx).update(ref(orgId), { ...patch });
    },

    setEntitlements(orgId: string, tx: Tx, value: { featureOverrides: FeatureMap; limitOverrides: LimitMap }): void {
      writer(tx).update(ref(orgId), value);
    },
  };
}
