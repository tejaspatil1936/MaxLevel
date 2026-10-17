import { z } from "zod";
import { Question, QuestionWithAnswer } from "@/types";

export const QuestionItemSchema = z.object({
  id: z.string().min(1, "Question ID must not be empty"),
  text: z.string().min(1, "Question text must not be empty"),
  options: z
    .array(z.string().min(1, "Option text must not be empty"))
    .length(4, "Question must have exactly 4 options"),
  correctIndex: z
    .number()
    .int("correctIndex must be an integer")
    .min(0, "correctIndex must be between 0 and 3")
    .max(3, "correctIndex must be between 0 and 3"),
  explanation: z.string().optional(),
  topic: z.string().optional(),
  source: z.string().optional(),
});

export const QuestionsUploadSchema = z.object({
  questions: z
    .array(QuestionItemSchema)
    .min(1, "Question set must contain at least 1 question"),
});

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: string;
  failingIndex?: number;
}

export function validateQuestionUpload(json: any): ValidationResult<{
  cleanQuestions: Question[];
  answerKey: Record<string, number>;
  explanations: Record<string, string>;
}> {
  if (!json || typeof json !== "object" || !Array.isArray(json.questions)) {
    return {
      valid: false,
      error: "Uploaded JSON must contain a 'questions' array.",
    };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < json.questions.length; i++) {
    const q = json.questions[i];
    const parseResult = QuestionItemSchema.safeParse(q);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return {
        valid: false,
        failingIndex: i,
        error: `Question at index ${i} is invalid: ${issue.message} (${issue.path.join(".")})`,
      };
    }

    if (seenIds.has(q.id)) {
      return {
        valid: false,
        failingIndex: i,
        error: `Duplicate question ID "${q.id}" at index ${i}. All IDs must be unique.`,
      };
    }
    seenIds.add(q.id);
  }

  const cleanQuestions: Question[] = [];
  const answerKey: Record<string, number> = {};
  const explanations: Record<string, string> = {};

  for (const item of json.questions as QuestionWithAnswer[]) {
    cleanQuestions.push({
      id: item.id,
      text: item.text,
      options: [item.options[0], item.options[1], item.options[2], item.options[3]],
      topic: item.topic,
      source: item.source,
    });
    answerKey[item.id] = item.correctIndex;
    if (item.explanation) {
      explanations[item.id] = item.explanation;
    }
  }

  return {
    valid: true,
    data: {
      cleanQuestions,
      answerKey,
      explanations,
    },
  };
}

export const SeriesCreateSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  window: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Start window must be HH:MM"),
    end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "End window must be HH:MM"),
    tz: z.string().default("Asia/Kolkata"),
  }),
  durationMin: z.number().int().min(5).max(180).default(30),
  maxStrikes: z.number().int().min(1).max(10).default(3),
  devtoolsOpenPolicy: z.enum(["strike", "submit"]).default("strike"),
  cameraStrikes: z.boolean().default(true),
  secondaryCameraRequired: z.boolean().default(true),
  resultsVisible: z.boolean().default(false),
  leaderboardVisible: z.boolean().default(false),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD").optional(),
  daysCount: z.number().int().min(1).max(30).default(5),
});

export const SeriesPatchSchema = z.object({
  title: z.string().min(2).optional(),
  window: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      tz: z.string().default("Asia/Kolkata"),
    })
    .optional(),
  durationMin: z.number().int().min(5).max(180).optional(),
  maxStrikes: z.number().int().min(1).max(10).optional(),
  devtoolsOpenPolicy: z.enum(["strike", "submit"]).optional(),
  cameraStrikes: z.boolean().optional(),
  secondaryCameraRequired: z.boolean().optional(),
  resultsVisible: z.boolean().optional(),
  leaderboardVisible: z.boolean().optional(),
});

export const TestCreateSchema = z.object({
  day: z.number().int().min(1).max(100),
  title: z.string().min(1, "Title is required"),
  company: z.string().min(1, "Company is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  window: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    })
    .nullable()
    .optional(),
  durationMin: z.number().int().min(5).max(180).nullable().optional(),
  resultsVisible: z.boolean().nullable().optional(),
  secondaryCameraRequired: z.boolean().nullable().optional(),
});

export const TestUpdateSchema = z.object({
  day: z.number().int().min(1).max(100).optional(),
  title: z.string().min(1, "Title is required"),
  company: z.string().min(1, "Company is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  window: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    })
    .nullable()
    .optional(),
  durationMin: z.number().int().min(5).max(180).nullable().optional(),
  resultsVisible: z.boolean().nullable().optional(),
  secondaryCameraRequired: z.boolean().nullable().optional(),
});
