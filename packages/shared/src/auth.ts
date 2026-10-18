import { z } from 'zod';
import { entitlementsSchema } from './entitlements';
import { preferencesSchema } from './preferences';

/** Custom claim role values (DECISIONS: superAdmin, admin, student, device). */
export const ROLES = ['superAdmin', 'admin', 'student', 'device'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Claims the API sets with setCustomUserClaims (ORG-02). */
export const claimsSchema = z.object({
  role: roleSchema,
  orgId: z.string().optional(),
  studentId: z.string().optional(),
  attemptId: z.string().optional(),
});
export type Claims = z.infer<typeof claimsSchema>;

/** Exact copy shown to an email on no list (AUTH-03). */
export const NOT_ON_LIST_MESSAGE =
  "This Google account isn't on any organization's list. Ask your placement cell to add it.";

export const bootstrapRequestSchema = z.object({ orgId: z.string().min(1).optional() }).default({});

export const orgChoiceSchema = z.object({ orgId: z.string(), name: z.string() });

export const bootstrapResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    role: roleSchema,
    orgId: z.string().nullable(),
    studentId: z.string().nullable(),
    /** The client must call getIdToken(true) so the new claims reach the API. */
    refreshToken: z.literal(true),
  }),
  z.object({ status: z.literal('choose_org'), orgs: z.array(orgChoiceSchema).min(2) }),
]);
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;

export const orgSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  status: z.enum(['active', 'suspended', 'archived']),
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const meResponseSchema = z.object({
  uid: z.string(),
  email: z.string(),
  role: roleSchema,
  orgId: z.string().nullable(),
  studentId: z.string().nullable(),
  org: orgSummarySchema.nullable(),
  /** Effective feature flags and limits of the org (GET /v1/me, FF-03). */
  entitlements: entitlementsSchema.nullable(),
  preferences: preferencesSchema,
  /** Students must finish their profile (and consent) before anything else (STU-01, SEC-08). */
  profileComplete: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
