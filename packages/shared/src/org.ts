import { z } from 'zod';
import { orgSummarySchema } from './auth';
import { entitlementsSchema } from './entitlements';

export const orgDetailSchema = orgSummarySchema.extend({ profileLocked: z.boolean() });
export type OrgDetail = z.infer<typeof orgDetailSchema>;

/** GET /v1/org: the workspace an admin, or a super admin with X-Org-Id, works in, with its entitlements (FF-03). */
export const orgWorkspaceSchema = orgDetailSchema.extend({ entitlements: entitlementsSchema });
export type OrgWorkspace = z.infer<typeof orgWorkspaceSchema>;

export const orgSettingsPatchSchema = z
  .object({ profileLocked: z.boolean() })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one setting.' });
export type OrgSettingsPatch = z.infer<typeof orgSettingsPatchSchema>;
