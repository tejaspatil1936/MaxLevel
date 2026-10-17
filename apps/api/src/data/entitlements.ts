import { featureMapSchema, limitMapSchema, type FeatureMap, type LimitMap } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

export interface EntitlementInputs {
  orgFeatures: FeatureMap;
  orgLimits: LimitMap;
  planFeatures: FeatureMap;
  planLimits: LimitMap;
  timezone: string;
}

export function entitlementsData(db: Firestore) {
  return {
    /** The organization's overrides and its plan's presets (FF-01 inputs). */
    async getEntitlementInputs(orgId: string): Promise<EntitlementInputs | null> {
      const org = await db.doc(`organizations/${orgId}`).get();
      if (!org.exists) return null;
      const plan = await db.doc(`plans/${org.get('planId') ?? 'standard'}`).get();
      return {
        orgFeatures: featureMapSchema.catch({}).parse(org.get('featureOverrides') ?? {}),
        orgLimits: limitMapSchema.catch({}).parse(org.get('limitOverrides') ?? {}),
        planFeatures: featureMapSchema.catch({}).parse(plan.get('features') ?? {}),
        planLimits: limitMapSchema.catch({}).parse(plan.get('limits') ?? {}),
        timezone: org.get('timezone') ?? 'Asia/Kolkata',
      };
    },
  };
}
