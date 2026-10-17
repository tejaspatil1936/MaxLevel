import { z } from 'zod';
import { orgSummarySchema } from './auth';

export const orgDetailSchema = orgSummarySchema.extend({ profileLocked: z.boolean() });
export type OrgDetail = z.infer<typeof orgDetailSchema>;

export const orgSettingsPatchSchema = z
  .object({ profileLocked: z.boolean() })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one setting.' });
export type OrgSettingsPatch = z.infer<typeof orgSettingsPatchSchema>;
