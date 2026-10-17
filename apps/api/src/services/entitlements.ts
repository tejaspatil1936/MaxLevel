import { monthKey, resolveEntitlements, type Clock, type Entitlements, type LimitKey } from '@mitaoe/shared';
import type { Data } from '../data';
import type { UsageField } from '../data/usage';
import { AppError } from '../errors';
import { TtlCache } from './ttl-cache';

/**
 * Effective feature flags and limits per organization (FF-01), cached for 60 seconds (PERF-02), so a change made by
 * a super admin applies within a minute (and at once on this instance, which invalidates on write).
 */
export function entitlementsService(data: Data, clock: Clock) {
  const cache = new TtlCache<(Entitlements & { timezone: string }) | null>(clock);
  const get = (orgId: string) =>
    cache.get(orgId, async () => {
      const inputs = await data.entitlements.getEntitlementInputs(orgId);
      return inputs ? { ...resolveEntitlements(inputs), timezone: inputs.timezone } : null;
    });

  return {
    get,
    invalidate: (orgId: string) => cache.delete(orgId),

    /** 403 FEATURE_DISABLED unless the feature is on for the organization (FF-02). */
    async requireFeature(orgId: string, feature: keyof Entitlements['features']): Promise<void> {
      const e = await get(orgId);
      if (!e?.features[feature]) {
        throw new AppError(403, 'FEATURE_DISABLED', "Not included in your organization's plan.", { feature });
      }
    },

    /** Takes one unit of a monthly allowance before a job starts, or throws LIMIT_REACHED (FF-04). */
    async takeMonthly(orgId: string, field: UsageField, limit: LimitKey): Promise<void> {
      const e = await get(orgId);
      if (!e) throw new AppError(404, 'NOT_FOUND', 'Organization not found.');
      const ok = await data.usage.takeUsage(orgId, monthKey(clock.now(), e.timezone), field, e.limits[limit]);
      if (!ok)
        throw new AppError(403, 'LIMIT_REACHED', "Your organization has used this month's allowance.", {
          limit,
          value: e.limits[limit],
        });
    },
  };
}
export type EntitlementsService = ReturnType<typeof entitlementsService>;
