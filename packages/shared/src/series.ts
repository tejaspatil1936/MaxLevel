import { z } from 'zod';
import { eligibilityRulesSchema } from './eligibility';
import { pageOf } from './page';
import { dailyWindowSchema, seriesDefaultsSchema, storedSettingsSchema } from './settings';

// Series (spec 5.1). Dates are yyyy-mm-dd strings; the daily window is minutes after midnight in the org timezone.

/** A calendar date as yyyy-mm-dd that exists (no 31 Nov). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Enter a real date.');

export const SERIES_STATUSES = ['draft', 'active', 'archived'] as const;
export const seriesStatusSchema = z.enum(SERIES_STATUSES);
export type SeriesStatus = z.infer<typeof seriesStatusSchema>;

export const seriesTitleSchema = z.string().trim().min(1, 'Enter the series title.').max(200);
const descriptionSchema = z.string().trim().max(2000);

export const seriesSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: seriesStatusSchema,
  startDate: z.string(),
  endDate: z.string(),
  dailyWindow: dailyWindowSchema.optional(),
  defaults: storedSettingsSchema,
  eligibility: eligibilityRulesSchema,
  testCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Series = z.infer<typeof seriesSchema>;
export const seriesPageSchema = pageOf(seriesSchema);

const endNotBeforeStart = (s: { startDate?: string; endDate?: string }) =>
  !s.startDate || !s.endDate || s.endDate >= s.startDate;
const END_BEFORE_START = { message: "The end date can't be before the start date.", path: ['endDate'] };

/** POST /v1/series: a new series is stored with status `draft`. */
export const seriesCreateSchema = z
  .object({
    title: seriesTitleSchema,
    description: descriptionSchema.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    dailyWindow: dailyWindowSchema,
    defaults: seriesDefaultsSchema.default({}),
    eligibility: eligibilityRulesSchema.default({ departmentIds: [], graduationYears: [], include: [], exclude: [] }),
  })
  .strict()
  .refine(endNotBeforeStart, END_BEFORE_START);
export type SeriesCreate = z.infer<typeof seriesCreateSchema>;

/** PATCH /v1/series/{id}: any of the fields; the API checks the dates against the stored ones. */
export const seriesPatchSchema = z
  .object({
    title: seriesTitleSchema,
    description: descriptionSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    dailyWindow: dailyWindowSchema,
    defaults: seriesDefaultsSchema,
    eligibility: eligibilityRulesSchema,
    status: seriesStatusSchema,
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' })
  .refine(endNotBeforeStart, END_BEFORE_START);
export type SeriesPatch = z.infer<typeof seriesPatchSchema>;

export const createdIdSchema = z.object({ id: z.string() });

/** POST /v1/series/{id}/eligibility/preview and /v1/tests/{id}/eligibility/preview (SER-07). */
export const eligibilityPreviewRequestSchema = z.object({ eligibility: eligibilityRulesSchema });
export const eligibilityPreviewResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  students: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      prn: z.string(),
      departmentId: z.string(),
      graduationYear: z.number().int(),
    }),
  ),
});
export type EligibilityPreview = z.infer<typeof eligibilityPreviewResponseSchema>;
