import { z } from 'zod';
import type { Difficulty } from './draw';
import type { QuestionCreate } from './question';

// JSON question import (Questions tab): the legacy format (spec 15.1) and this project's `mitaoe-questions/1`.

export interface ImportedQuestion {
  prompt: string;
  options: string[];
  /** 0-based indexes; empty = none. */
  correct: number[];
  explanation?: string;
  difficulty?: Difficulty;
  marks?: number;
  negativeMarks?: number;
  tags: string[];
  timeLimitSec?: number;
}

export const MITAOE_QUESTIONS_FORMAT = 'mitaoe-questions/1';
const MAX_QUESTIONS = 1000;

const promptText = z.string().max(20000);
const optionTexts = z.array(z.string().max(5000)).min(1).max(6);

/** Legacy: `{ questions: [{ id, text, options, correctIndex, explanation, topic, source }] }`, no `format` key. */
const legacyFileSchema = z.object({
  questions: z
    .array(
      z.object({
        text: promptText,
        options: optionTexts,
        correctIndex: z.unknown().optional(),
        explanation: z.string().max(20000).optional(),
        topic: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
});

const letterSchema = z
  .string()
  .trim()
  .regex(/^[A-Fa-f]$/);
const mitaoeFileSchema = z.object({
  format: z.literal(MITAOE_QUESTIONS_FORMAT),
  questions: z
    .array(
      z.object({
        prompt: promptText,
        options: optionTexts,
        correct: z.union([letterSchema, z.array(letterSchema).max(6)]).optional(),
        explanation: z.string().max(20000).optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
        marks: z.number().positive().max(1000).optional(),
        negativeMarks: z.number().min(0).max(1000).optional(),
        tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
        timeLimitSec: z.number().int().min(1).max(3600).optional(),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
});

const nonEmpty = (s: string | undefined) => (s !== undefined && s.trim() !== '' ? s : undefined);
const withoutUndefined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Parses an import file's JSON. Anything that is neither format gives `{ error: 'INVALID' }`. */
export function parseQuestionJson(json: unknown): { questions: ImportedQuestion[] } | { error: 'INVALID' } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { error: 'INVALID' };
  if ('format' in json) {
    const file = mitaoeFileSchema.safeParse(json);
    if (!file.success) return { error: 'INVALID' };
    return {
      questions: file.data.questions.map((q) => {
        const letters = q.correct === undefined ? [] : Array.isArray(q.correct) ? q.correct : [q.correct];
        const correct = [...new Set(letters.map((l) => l.toUpperCase().charCodeAt(0) - 65))].filter(
          (i) => i < q.options.length,
        );
        return withoutUndefined({
          prompt: q.prompt,
          options: q.options,
          correct,
          explanation: nonEmpty(q.explanation),
          difficulty: q.difficulty,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          tags: q.tags ?? [],
          timeLimitSec: q.timeLimitSec,
        });
      }),
    };
  }
  const file = legacyFileSchema.safeParse(json);
  if (!file.success) return { error: 'INVALID' };
  return {
    questions: file.data.questions.map((q) => {
      const i = q.correctIndex;
      const inRange = typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < q.options.length;
      const topic = nonEmpty(q.topic)?.trim();
      return withoutUndefined({
        prompt: q.text,
        options: q.options,
        correct: inRange ? [i] : [],
        explanation: nonEmpty(q.explanation),
        tags: topic ? [topic] : [],
      });
    }),
  };
}

const LETTERS = 'abcdef';

/** An imported question as a create request: empty options dropped, option IDs `a` to `f` in order. */
export function importedToQuestionInput(q: ImportedQuestion): QuestionCreate {
  const kept = q.options.flatMap((text, i) => (text.trim() === '' ? [] : [i]));
  const idOf = (i: number) => LETTERS[kept.indexOf(i)]!;
  return withoutUndefined({
    prompt: q.prompt,
    options: kept.map((i) => ({ id: idOf(i), text: q.options[i]! })),
    correctOptionIds: q.correct.filter((i) => kept.includes(i)).map(idOf),
    explanation: q.explanation,
    difficulty: q.difficulty,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    tags: q.tags,
    timeLimitSec: q.timeLimitSec,
    images: [],
  });
}
