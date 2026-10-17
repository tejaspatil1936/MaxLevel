import { z } from 'zod';
import { orgSummarySchema } from './auth';

export const orgDetailSchema = orgSummarySchema.extend({ profileLocked: z.boolean() });
export type OrgDetail = z.infer<typeof orgDetailSchema>;

export const orgSettingsPatchSchema = z.object({ profileLocked: z.boolean() }).partial().strict();
export type OrgSettingsPatch = z.infer<typeof orgSettingsPatchSchema>;
