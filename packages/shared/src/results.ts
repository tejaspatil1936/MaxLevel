import { z } from 'zod';
import { FINISHED_ATTEMPT_STATUSES } from './attempt';
import { releaseStateSchema } from './release';
import { settingsSchema } from './settings';

// What a student and an admin see of a test's results (spec 8.1, docs/testids/phase-4.md "Result" and "Result
// release"). Nothing but the full review carries an answer key or an explanation, and only once released (DATA-05).

const id = z.string().min(1).max(128);
const resultReleaseSchema = settingsSchema.shape.resultRelease;
const resultDetailSchema = settingsSchema.shape.resultDetail;

/** Questions in no section of a sectioned test, as one entry of the section scores. */
export const OTHER_QUESTIONS = 'Other questions';

export const resultSectionSchema = z.object({
  sectionId: z.string().nullable(),
  name: z.string(),
  score: z.number(),
  max: z.number(),
  correct: z.number().int(),
  incorrect: z.number().int(),
  unanswered: z.number().int(),
});
export type ResultSection = z.infer<typeof resultSectionSchema>;

/** One question of a released full review (RES-03, SER-10), options in the order the student saw them. */
export const reviewItemSchema = z.object({
  questionId: z.string(),
  sectionId: z.string().nullable(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  chosenOptionId: z.string().nullable(),
  correctOptionIds: z.array(z.string()),
  marks: z.number(),
  explanation: z.string().optional(),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

/** Released-only keys of the student result: none of them is sent unless `release` is `released` (RES-01). */
export const RELEASED_RESULT_KEYS = [
  'detail',
  'score',
  'max',
  'pct',
  'durationSec',
  'rank',
  'rankNote',
  'sections',
  'review',
] as const;

/**
 * Why a released result has no rank line with numbers (RES-02, LB-04, PR-10): `after_close` while a flexible window is
 * still open, `not_ranked` for a terminated attempt. Only sent while the test leaderboard is on.
 */
export const RANK_NOTES = ['after_close', 'not_ranked'] as const;

/**
 * `GET /v1/student/results/{attemptId}`. The score keys are present only when `release` is `released`; `review` only
 * for a released full review. `title`, `dayLabel`, `resultRelease` and `windowEnd` let the page name the test and say
 * when results come. The refinement makes the response schema refuse an answer key outside a released full review, so
 * a bug upstream fails the request instead of leaking it (DATA-05).
 */
const studentResultShape = z.object({
  attemptId: z.string(),
  testId: z.string(),
  title: z.string(),
  dayLabel: z.string().nullable(),
  status: z.enum(FINISHED_ATTEMPT_STATUSES),
  terminationReason: z.string().optional(),
  strikesCount: z.number().int().min(0),
  maxStrikes: z.number().int(),
  resultRelease: resultReleaseSchema,
  windowEnd: z.number().int().nullable(),
  release: releaseStateSchema,
  detail: resultDetailSchema.optional(),
  score: z.number().optional(),
  max: z.number().optional(),
  pct: z.number().optional(),
  durationSec: z.number().int().optional(),
  rank: z.object({ rank: z.number().int().min(1), total: z.number().int().min(1) }).optional(),
  rankNote: z.enum(RANK_NOTES).optional(),
  sections: z.array(resultSectionSchema).optional(),
  review: z.array(reviewItemSchema).optional(),
});
export const studentResultSchema = studentResultShape.superRefine((r, ctx) => {
  const leaked =
    r.release === 'released'
      ? [
          ...(r.detail === 'score' && r.sections ? ['sections'] : []),
          ...(r.detail !== 'full' && r.review ? ['review'] : []),
        ]
      : RELEASED_RESULT_KEYS.filter((k) => r[k] !== undefined);
  for (const key of leaked)
    ctx.addIssue({ code: 'custom', path: [key], message: `${key} is not sent with this release state and detail.` });
});
export type StudentResult = z.infer<typeof studentResultShape>;

/**
 * A published test as the admin results pages list it (US-AD-10): its release setting and state, the window end, and
 * why Release results is refused now (null when it can be pressed).
 */
export const testReleaseSummarySchema = z.object({
  testId: id,
  title: z.string(),
  dayLabel: z.string().nullable(),
  seriesId: z.string(),
  seriesTitle: z.string(),
  scheduledDate: z.string(),
  resultRelease: resultReleaseSchema,
  resultDetail: resultDetailSchema,
  state: releaseStateSchema,
  windowEnd: z.number().int().nullable(),
  resultsReleasedAt: z.number().int().nullable(),
  refusal: z.enum(['RESULTS_NOT_RELEASABLE', 'FULL_REVIEW_BEFORE_CLOSE', 'FULL_REVIEW_WHILE_ANSWERING']).nullable(),
});
export type TestReleaseSummary = z.infer<typeof testReleaseSummarySchema>;

/** `GET /v1/results`: published tests (newest date first) and the series that hold them. */
export const resultsOverviewSchema = z.object({
  tests: z.array(testReleaseSummarySchema),
  series: z.array(z.object({ id: z.string(), title: z.string(), testCount: z.number().int().min(1) })),
});
export type ResultsOverview = z.infer<typeof resultsOverviewSchema>;
