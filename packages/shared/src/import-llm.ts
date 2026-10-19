import { z } from 'zod';
import type { Difficulty } from './draw';

// The model's side of an AI import (IMP-05, IMP-06; docs/testids/phase-6.md "Model output schema"): the output schema
// every answer is validated against, the system instructions, the user message that fences the file's content as
// data, and the mapping of an answer to drafts. Pure functions; the worker calls the model through the AI SDK.

const fraction = z.number().min(0).max(1);
/** Where something is on its page, as fractions of the page's width and height from its top-left corner. */
export const boxSchema = z.object({ x: fraction, y: fraction, w: fraction, h: fraction });
export type Box = z.infer<typeof boxSchema>;

/** Option IDs `a` to `f`, in order (template columns Option A to Option F). */
export const IMPORT_MAX_OPTIONS = 6;

const llmQuestionObject = z.object({
  prompt: z.string().max(20000),
  options: z.array(z.string().max(5000)).max(IMPORT_MAX_OPTIONS),
  /** 0-based indexes of the options the source marks correct; [] when it marks none. */
  correct: z.array(z.number().int().min(0)).max(IMPORT_MAX_OPTIONS),
  explanation: z.string().max(20000).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  section: z.string().max(200).optional(),
  refersToFigure: z.boolean().optional(),
  figure: z.object({ box: boxSchema, alt: z.string().max(500) }).optional(),
  box: boxSchema.optional(),
});
export type LlmQuestion = z.infer<typeof llmQuestionObject>;
/** One question as the model returns it. Unknown keys are dropped. */
export const LlmQuestionSchema: z.ZodType<LlmQuestion> = llmQuestionObject;
/** One model call's whole answer. */
export const LlmAnswerSchema = z.object({ questions: z.array(llmQuestionObject) });
export type LlmAnswer = z.infer<typeof LlmAnswerSchema>;

/** A draft as the worker first saves it, before figures are cropped into `images` and the checks run. */
export interface DraftInput {
  order: number;
  /** PDF page; part number for TXT, MD and non-template sheets; row number (header = 1) for template sheets. */
  sourcePage: number;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctOptionIds: string[];
  explanation?: string;
  difficulty?: Difficulty;
  difficultySuggested: boolean;
  sectionName?: string;
  refersToFigure?: boolean;
  /** The figure the model located, still to be cropped from the page and stored. */
  figure?: { box: Box; alt: string };
  box?: Box;
  images: Array<{ path: string; alt: string }>;
}

/** Option ID of a 0-based index: a, b, … (an index past the options names a missing option, which is flagged). */
export const optionIdOf = (index: number): string => String.fromCharCode(97 + index);

const present = (s: string | undefined) => (s !== undefined && s.trim() !== '' ? s : undefined);

/**
 * Drafts from one call's questions, numbered from `startOrder`. Text is copied unchanged (IMP-05); the correct
 * answers come only from `correct`; an explanation only when the model gave one; difficulty is marked a suggestion.
 */
export function draftsFromModel(page: number, questions: ReadonlyArray<LlmQuestion>, startOrder: number): DraftInput[] {
  return questions.map((q, i) => {
    const draft: DraftInput = {
      order: startOrder + i,
      sourcePage: page,
      prompt: q.prompt,
      options: q.options.map((text, k) => ({ id: optionIdOf(k), text })),
      correctOptionIds: [...new Set(q.correct)].sort((a, b) => a - b).map(optionIdOf),
      difficultySuggested: true,
      images: [],
    };
    const explanation = present(q.explanation);
    if (explanation !== undefined) draft.explanation = explanation;
    if (q.difficulty !== undefined) draft.difficulty = q.difficulty;
    const section = present(q.section);
    if (section !== undefined) draft.sectionName = section;
    if (q.refersToFigure !== undefined) draft.refersToFigure = q.refersToFigure;
    if (q.figure !== undefined) draft.figure = q.figure;
    if (q.box !== undefined) draft.box = q.box;
    return draft;
  });
}
