import {
  questionProblems,
  type Difficulty,
  type Question,
  type QuestionCreate,
  type QuestionPatch,
  type QuestionProblem,
} from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';

// The question editor's form state (Q-01) and how it becomes a request. Numbers stay text while typed; empty means
// "not set" (marks and negative marks then come from the section or test, Q-07).

export const OPTION_IDS = 'abcdef';
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export interface DraftImage {
  path: string;
  alt: string;
  /** A data URL to show it; null when the stored file is missing. */
  src: string | null;
}

export interface QuestionDraft {
  prompt: string;
  options: Array<{ id: string; text: string }>;
  /** The correct option's ID, or '' for none (v1 is single answer, DECISIONS Q13). */
  correct: string;
  explanation: string;
  difficulty: Difficulty | '';
  sectionId: string;
  marks: string;
  negativeMarks: string;
  timeLimit: string;
  tags: string;
  images: DraftImage[];
}

export type DraftField = 'marks' | 'negativeMarks' | 'timeLimit';
export type DraftErrors = Partial<Record<DraftField, MessageKey>>;

const num = (n: number | undefined) => (n === undefined ? '' : String(n));

/** A new question has four empty options; an existing one starts from its stored values. */
export function draftFrom(q?: Question, imageUrls: Record<string, string> = {}): QuestionDraft {
  return {
    prompt: q?.prompt ?? '',
    options: q?.options.map((o) => ({ id: o.id, text: o.text })) ?? [...'abcd'].map((id) => ({ id, text: '' })),
    correct: q?.correctOptionIds[0] ?? '',
    explanation: q?.explanation ?? '',
    difficulty: q?.difficulty ?? '',
    sectionId: q?.sectionId ?? '',
    marks: num(q?.marks),
    negativeMarks: num(q?.negativeMarks),
    timeLimit: num(q?.timeLimitSec),
    tags: q?.tags.join(', ') ?? '',
    images: q?.images.map((img) => ({ ...img, src: imageUrls[img.path] ?? null })) ?? [],
  };
}

/** The first unused option ID, for `Add option`. */
export const nextOptionId = (options: QuestionDraft['options']) =>
  [...OPTION_IDS].find((id) => !options.some((o) => o.id === id)) ?? `o${options.length + 1}`;

/** Field errors for the number fields, as message keys. */
export function draftErrors(d: QuestionDraft): DraftErrors {
  const errors: DraftErrors = {};
  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const marks = n(d.marks);
  if (marks !== null && !(marks > 0 && marks <= 1000)) errors.marks = 'questions.marksInvalid';
  const negative = n(d.negativeMarks);
  if (negative !== null && !(negative >= 0 && negative <= 1000)) errors.negativeMarks = 'questions.negativeInvalid';
  const seconds = n(d.timeLimit);
  if (seconds !== null && !(Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600))
    errors.timeLimit = 'questions.timeLimitInvalid';
  return errors;
}

const optional = (s: string) => (s.trim() === '' ? undefined : s.trim());
const optionalNumber = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** The create request: empty option rows dropped, tags split at commas. */
export function draftToCreate(d: QuestionDraft): QuestionCreate {
  const options = d.options.filter((o) => o.text.trim() !== '').map((o) => ({ id: o.id, text: o.text.trim() }));
  const body: QuestionCreate = {
    prompt: d.prompt,
    options,
    correctOptionIds: options.some((o) => o.id === d.correct) ? [d.correct] : [],
    explanation: optional(d.explanation),
    difficulty: d.difficulty || undefined,
    sectionId: optional(d.sectionId),
    marks: optionalNumber(d.marks),
    negativeMarks: optionalNumber(d.negativeMarks),
    timeLimitSec: optionalNumber(d.timeLimit),
    tags: [
      ...new Set(
        d.tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ],
    images: d.images.map(({ path, alt }) => ({ path, alt: alt.trim() })),
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as QuestionCreate;
}

/** The patch request: every field, with null clearing what was emptied. */
export function draftToPatch(d: QuestionDraft): QuestionPatch {
  const c = draftToCreate(d);
  return {
    ...c,
    explanation: c.explanation ?? null,
    difficulty: c.difficulty ?? null,
    sectionId: c.sectionId ?? null,
    marks: c.marks ?? null,
    negativeMarks: c.negativeMarks ?? null,
    timeLimitSec: c.timeLimitSec ?? null,
  };
}

/**
 * The checks the server runs (DECISIONS Q17), live while typing. `others` are the test's questions in order with
 * the edited question's own slot blank, so a duplicate is named by its position.
 */
export function draftProblems(d: QuestionDraft, others: ReadonlyArray<{ prompt: string }>): QuestionProblem[] {
  const c = draftToCreate(d);
  return questionProblems({ ...c, correctOptionIds: c.correctOptionIds ?? [], images: c.images ?? [] }, others);
}
