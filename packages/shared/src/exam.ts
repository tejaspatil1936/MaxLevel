import { z } from 'zod';
import { studentQuestionSchema } from './question';

// The exam payload (EX-03, Q-13): what the exam screen renders. Phase 3's attempt start returns it without the answer
// key; the admin preview returns it with each question's correct option and explanation.

/** A section as the exam screen shows it. */
export const examSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  instructions: z.string().optional(),
  durationMin: z.number().int().optional(),
  forwardOnly: z.boolean(),
});
export type ExamSection = z.infer<typeof examSectionSchema>;

export const examPayloadSchema = z.object({
  test: z.object({ id: z.string(), title: z.string(), dayLabel: z.string().nullable() }),
  durationMin: z.number().int(),
  /** The test's sections in order; empty for a test without sections. */
  sections: z.array(examSectionSchema),
  /** In exam order, each with its options in the order shown. No answer key (DATA-05). */
  questions: z.array(studentQuestionSchema),
  /** Each image path of these questions as a URL to show it. */
  imageUrls: z.record(z.string(), z.string()),
});
export type ExamPayload = z.infer<typeof examPayloadSchema>;

export const previewQuestionSchema = studentQuestionSchema.extend({
  correctOptionIds: z.array(z.string()),
  explanation: z.string().optional(),
});
export type PreviewQuestion = z.infer<typeof previewQuestionSchema>;

/** GET /v1/tests/{id}/preview (admins only): a fresh draw with the answer key, for Show answers (Q-13). */
export const examPreviewSchema = examPayloadSchema.extend({ questions: z.array(previewQuestionSchema) });
export type ExamPreview = z.infer<typeof examPreviewSchema>;
