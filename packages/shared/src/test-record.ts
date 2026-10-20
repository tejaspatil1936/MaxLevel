import { z } from 'zod';
import { eligibilityRulesSchema } from './eligibility';
import { docIdSchema } from './ids';
import { isoDateSchema } from './series';
import { settingsOverridesSchema, settingsSchema, storedSettingsSchema } from './settings';

// Tests and sections (spec 5.2, 6.5). The status is never set through PATCH (DECISIONS: phase 2 lifecycle).

export const TEST_STATUSES = ['draft', 'in_review', 'approved', 'scheduled', 'live', 'closed'] as const;
export const testStatusSchema = z.enum(TEST_STATUSES);
export type TestStatus = z.infer<typeof testStatusSchema>;

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

const count = z.number().int().min(0).max(1000);
export const difficultyMixSchema = z.object({ easy: count, medium: count, hard: count });

export const sectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Enter the section name.').max(80),
  order: z.number().int().min(1),
  instructions: z.string().max(5000).optional(),
  durationMin: z.number().int().min(1).max(1440).optional(),
  drawCount: z.number().int().min(1).max(1000).optional(),
  difficultyMix: difficultyMixSchema.optional(),
  forwardOnly: z.boolean().default(false),
  marks: z.number().positive().max(1000).optional(),
  negativeMarks: z.number().min(0).max(1000).optional(),
});
export type Section = z.infer<typeof sectionSchema>;
/** A section in PATCH /v1/tests/{id}: entries without `id` are new. */
export const sectionInputSchema = sectionSchema.extend({ id: z.string().min(1).max(128).optional() });

export const testTitleSchema = z.string().trim().min(1, 'Enter the test title.').max(200);
const companySchema = z.string().trim().max(120);
const dayNumberSchema = z.string().trim().max(40);

export const approvalSchema = z.object({
  status: z.literal('approved'),
  approvedBy: z.string(),
  approvedAt: z.number(),
});

export const testSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  title: z.string(),
  company: z.string().optional(),
  dayNumber: z.string().nullable().optional(),
  dayHidden: z.boolean(),
  /** As shown: the day label of TST-02, or null when hidden. */
  dayLabel: z.string().nullable(),
  scheduledDate: z.string(),
  overrides: storedSettingsSchema,
  eligibility: eligibilityRulesSchema,
  sections: z.array(sectionSchema),
  drawCount: z.number().int().optional(),
  status: testStatusSchema,
  approval: approvalSchema.optional(),
  resolved: settingsSchema.optional(),
  questionSetVersion: z.number().int(),
  totalMarks: z.number(),
  attemptsStarted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Test = z.infer<typeof testSchema>;
export const testListSchema = z.object({ items: z.array(testSchema) });

/** GET /v1/tests/{id}: the test with its settings resolved now (window in UTC ms). */
export const testDetailSchema = testSchema.extend({ effective: settingsSchema });
export type TestDetail = z.infer<typeof testDetailSchema>;

export const testListQuerySchema = z.object({ seriesId: docIdSchema });

/** POST /v1/tests: a new test is stored with `overrides: {}` and status `draft`. */
export const testCreateSchema = z
  .object({
    seriesId: docIdSchema,
    title: testTitleSchema,
    company: companySchema.optional(),
    dayNumber: dayNumberSchema.nullable().optional(),
    dayHidden: z.boolean().default(false),
    scheduledDate: isoDateSchema,
  })
  .strict();
export type TestCreate = z.infer<typeof testCreateSchema>;

/** PATCH /v1/tests/{id}: `overrides` replaces the whole override map and `sections` the whole section list. */
export const testPatchSchema = z
  .object({
    title: testTitleSchema,
    company: companySchema.nullable(),
    dayNumber: dayNumberSchema.nullable(),
    dayHidden: z.boolean(),
    scheduledDate: isoDateSchema,
    overrides: settingsOverridesSchema,
    eligibility: eligibilityRulesSchema,
    sections: z.array(sectionInputSchema).max(20),
    drawCount: z.number().int().min(1).max(1000).nullable(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' });
export type TestPatch = z.infer<typeof testPatchSchema>;

export const approveResponseSchema = z.object({ status: z.literal('approved'), totalMarks: z.number() });
export const publishResponseSchema = z.object({ status: z.literal('scheduled') });

/**
 * The status shown for a test at `now` (TST-04): a scheduled test is `live` while now is inside its resolved window
 * and `closed` once the window has ended. Every other stored status is shown as stored.
 */
export function testStatusAt(
  stored: TestStatus,
  window: { start: number; end: number } | null | undefined,
  now: number,
): TestStatus {
  if (stored !== 'scheduled' || !window) return stored;
  if (now >= window.end) return 'closed';
  return now >= window.start ? 'live' : 'scheduled';
}
