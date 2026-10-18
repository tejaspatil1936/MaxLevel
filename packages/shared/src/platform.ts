import { z } from 'zod';
import { auditEntrySchema } from './audit';
import { entitlementsSchema, featureMapSchema, limitMapSchema } from './entitlements';
import { pageQuerySchema } from './page';

// Super-admin console (spec 2.3, 2.4, US-SA-01 to US-SA-06).

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/, 'Use 3 to 42 lowercase letters, digits or hyphens.');

/** Any IANA zone the runtime knows, including canonical names it lists under an alias (Asia/Kolkata). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const orgStatusSchema = z.enum(['active', 'suspended', 'archived']);

/** A logo sent with the create or edit form, base64-encoded; checked by file signature on the server (SEC-06). */
export const logoUploadSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
  data: z.string().max(700_000), // about 512 KB of image
});
export type LogoUpload = z.infer<typeof logoUploadSchema>;

export const orgCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  timezone: z.string().default('Asia/Kolkata').refine(isTimeZone, 'Choose a timezone from the list.'),
  departments: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  logo: logoUploadSchema.optional(),
});

export const orgPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().refine(isTimeZone, 'Choose a timezone from the list.'),
    status: orgStatusSchema,
    logo: logoUploadSchema,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' });

export const usageSchema = z.object({
  month: z.string(),
  students: z.number().int(),
  admins: z.number().int(),
  testsRun: z.number().int(),
  aiImports: z.number().int(),
  aiReports: z.number().int(),
  storageBytes: z.number().int(),
});
export type OrgUsage = z.infer<typeof usageSchema>;

export const platformOrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  status: orgStatusSchema,
  logoPath: z.string().nullable(),
  /** The logo as a data URL, so an <img> can show it without a signed link. */
  logoUrl: z.string().nullable(),
  createdAt: z.number(),
  usage: usageSchema,
  entitlements: entitlementsSchema,
});
export type PlatformOrg = z.infer<typeof platformOrgSchema>;

export const orgAdminSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(['active', 'removed']),
  signedIn: z.boolean(),
  addedAt: z.number(),
});
export type OrgAdmin = z.infer<typeof orgAdminSchema>;

export const platformOrgDetailSchema = platformOrgSchema.extend({
  admins: z.array(orgAdminSchema),
  departments: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(['active', 'archived']) })),
  featureOverrides: featureMapSchema,
  limitOverrides: limitMapSchema,
  planId: z.string(),
});
export type PlatformOrgDetail = z.infer<typeof platformOrgDetailSchema>;

export const adminAddSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().max(120).optional(),
});

export const entitlementsPutSchema = z.object({
  featureOverrides: featureMapSchema,
  limitOverrides: limitMapSchema,
});

export const auditQuerySchema = pageQuerySchema.extend({
  orgId: z.string().optional(),
  actor: z.string().trim().max(320).optional(),
  action: z.string().trim().max(120).optional(),
  target: z.string().trim().max(200).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});
export const auditPageSchema = z.object({ items: z.array(auditEntrySchema), nextCursor: z.string().nullable() });
