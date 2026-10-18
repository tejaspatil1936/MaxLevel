import { z } from 'zod';
import { difficultySchema } from './test-record';

// Questions (spec 6.1). v1 is single correct answer; correctOptionIds stays an array (DECISIONS Q13).

export const questionImageSchema = z.object({
  path: z.string().min(1).max(500),
  /** Empty alt text is stored and flagged by the checks (A11Y-10). */
  alt: z.string().max(500),
});
export type QuestionImage = z.infer<typeof questionImageSchema>;

export const optionSchema = z.object({
  id: z.string().min(1).max(16),
  text: z.string().max(5000),
  image: questionImageSchema.optional(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

export const QUESTION_STATUSES = ['draft', 'flagged', 'approved'] as const;
export const questionStatusSchema = z.enum(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const questionProblemSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('NO_CORRECT_ANSWER') }),
  z.object({ code: z.literal('TOO_FEW_OPTIONS') }),
  z.object({ code: z.literal('EMPTY_PROMPT') }),
  z.object({ code: z.literal('MULTIPLE_CORRECT') }),
  z.object({ code: z.literal('DUPLICATE'), of: z.number().int().min(1) }),
  z.object({ code: z.literal('IMAGE_WITHOUT_ALT'), image: z.number().int().min(1) }),
]);

const marksSchema = z.number().positive().max(1000);
const negativeMarksSchema = z.number().min(0).max(1000);
const timeLimitSchema = z.number().int().min(1).max(3600);
const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(20);

/** A question as admins see it, answer key included. */
export const questionSchema = z.object({
  id: z.string(),
  testId: z.string(),
  sectionId: z.string().optional(),
  order: z.number().int(),
  type: z.literal('single'),
  prompt: z.string(),
  images: z.array(questionImageSchema),
  options: z.array(optionSchema),
  correctOptionIds: z.array(z.string()),
  explanation: z.string().optional(),
  marks: z.number().optional(),
  negativeMarks: z.number().optional(),
  difficulty: difficultySchema.optional(),
  tags: z.array(z.string()),
  timeLimitSec: z.number().int().optional(),
  source: z.object({
    kind: z.enum(['manual', 'json', 'ai']),
    jobId: z.string().optional(),
    page: z.number().int().optional(),
  }),
  status: questionStatusSchema,
  /** Why a draft is a draft (DECISIONS Q17). */
  problems: z.array(questionProblemSchema).default([]),
});
export type Question = z.infer<typeof questionSchema>;
export const questionListSchema = z.object({ items: z.array(questionSchema) });

const uniqueOptionIds = (q: { options?: Array<{ id: string }> }) =>
  !q.options || new Set(q.options.map((o) => o.id)).size === q.options.length;
const UNIQUE_IDS = { message: 'Option IDs must be unique.', path: ['options'] };

const questionFields = {
  prompt: z.string().max(20000),
  options: z.array(optionSchema).max(6),
  correctOptionIds: z.array(z.string().min(1).max(16)).max(6),
  explanation: z.string().max(20000),
  difficulty: difficultySchema,
  sectionId: z.string().min(1).max(128),
  marks: marksSchema,
  negativeMarks: negativeMarksSchema,
  tags: tagsSchema,
  timeLimitSec: timeLimitSchema,
  images: z.array(questionImageSchema).max(10),
};

/** POST /v1/tests/{id}/questions. Problems make a draft, not a 400 (DECISIONS Q17). */
export const questionCreateSchema = z
  .object({
    ...questionFields,
    correctOptionIds: questionFields.correctOptionIds.default([]),
    explanation: questionFields.explanation.optional(),
    difficulty: questionFields.difficulty.optional(),
    sectionId: questionFields.sectionId.optional(),
    marks: questionFields.marks.optional(),
    negativeMarks: questionFields.negativeMarks.optional(),
    tags: questionFields.tags.default([]),
    timeLimitSec: questionFields.timeLimitSec.optional(),
    images: questionFields.images.default([]),
  })
  .strict()
  .refine(uniqueOptionIds, UNIQUE_IDS);
export type QuestionCreate = z.infer<typeof questionCreateSchema>;

/** PATCH /v1/tests/{id}/questions/{questionId}: any field; null clears an optional one. */
export const questionPatchSchema = z
  .object({
    ...questionFields,
    explanation: questionFields.explanation.nullable(),
    difficulty: questionFields.difficulty.nullable(),
    sectionId: questionFields.sectionId.nullable(),
    marks: questionFields.marks.nullable(),
    negativeMarks: questionFields.negativeMarks.nullable(),
    timeLimitSec: questionFields.timeLimitSec.nullable(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' })
  .refine(uniqueOptionIds, UNIQUE_IDS);
export type QuestionPatch = z.infer<typeof questionPatchSchema>;

export const questionSavedSchema = z.object({ id: z.string(), status: questionStatusSchema });
/** PUT /v1/tests/{id}/questions/order: every question ID of the test, in the new order. */
export const questionOrderSchema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(1000) });

/**
 * A question as a student receives it during an attempt. It has no `correctOptionIds` and no `explanation`, and
 * parsing strips them, so a student-facing response can never carry the answer key before a full review.
 */
export const studentQuestionSchema = z.object({
  id: z.string(),
  sectionId: z.string().optional(),
  prompt: z.string(),
  images: z.array(questionImageSchema),
  options: z.array(optionSchema),
  marks: z.number().optional(),
  negativeMarks: z.number().optional(),
  timeLimitSec: z.number().int().optional(),
});
export type StudentQuestion = z.infer<typeof studentQuestionSchema>;
