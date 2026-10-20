import { z } from 'zod';

// Feature flags and limits (spec 2.4). Every feature is on by default except analytics reports.
export const FEATURE_DEFAULTS = {
  ai_question_import: true,
  question_pools: true,
  sections: true,
  negative_marking: true,
  per_question_timer: true,
  second_camera: true,
  public_leaderboards: true,
  extra_time_grants: true,
  results_export: true,
  analytics_reports: false,
} as const;
export type FeatureFlag = keyof typeof FEATURE_DEFAULTS;
export const FEATURE_FLAGS = Object.keys(FEATURE_DEFAULTS) as FeatureFlag[];
export const featureFlagSchema = z.enum(FEATURE_FLAGS as [FeatureFlag, ...FeatureFlag[]]);

export const LIMIT_DEFAULTS = {
  max_students: 2000,
  max_admins: 10,
  ai_imports_per_month: 50,
  ai_reports_per_month: 20,
  storage_gb: 10,
} as const;
export type LimitKey = keyof typeof LIMIT_DEFAULTS;
export const LIMIT_KEYS = Object.keys(LIMIT_DEFAULTS) as LimitKey[];
export const limitKeySchema = z.enum(LIMIT_KEYS as [LimitKey, ...LimitKey[]]);

export const featureMapSchema = z.partialRecord(featureFlagSchema, z.boolean());
export const limitMapSchema = z.partialRecord(limitKeySchema, z.number().int().nonnegative());
export type FeatureMap = z.infer<typeof featureMapSchema>;
export type LimitMap = z.infer<typeof limitMapSchema>;

export interface Entitlements {
  features: Record<FeatureFlag, boolean>;
  limits: Record<LimitKey, number>;
}
export const entitlementsSchema = z.object({
  features: z.record(featureFlagSchema, z.boolean()),
  limits: z.record(limitKeySchema, z.number()),
});

/** Effective value: the organization's override, then its plan, then the system default (FF-01). */
export function resolveEntitlements(input: {
  orgFeatures?: FeatureMap;
  orgLimits?: LimitMap;
  planFeatures?: FeatureMap;
  planLimits?: LimitMap;
}): Entitlements {
  const features = Object.fromEntries(
    FEATURE_FLAGS.map((f) => [f, input.orgFeatures?.[f] ?? input.planFeatures?.[f] ?? FEATURE_DEFAULTS[f]]),
  ) as Record<FeatureFlag, boolean>;
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((l) => [l, input.orgLimits?.[l] ?? input.planLimits?.[l] ?? LIMIT_DEFAULTS[l]]),
  ) as Record<LimitKey, number>;
  return { features, limits };
}

/** Calendar month key (yyyy-mm) of an instant in a timezone, for monthly usage counters (FF-04). */
export function monthKey(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(nowMs);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}
