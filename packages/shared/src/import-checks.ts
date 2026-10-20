import { normalizePrompt, questionProblems } from './question-checks';

// Question checks on import drafts (IMP-09, IMP-10; docs/testids/phase-6.md "Question checks on drafts"). They build
// on the manual question checks (DECISIONS Q17) and add the import-only ones: duplicates within the import and figures.

export type ImportProblem =
  | { code: 'NO_CORRECT_ANSWER' }
  | { code: 'TOO_FEW_OPTIONS' }
  | { code: 'MULTIPLE_CORRECT' }
  | { code: 'EMPTY_PROMPT' }
  | { code: 'DUPLICATE_IN_TEST'; of: number }
  | { code: 'DUPLICATE_IN_IMPORT'; of: number }
  | { code: 'MISSING_FIGURE' }
  | { code: 'IMAGE_WITHOUT_ALT'; image: number };
export type ImportProblemCode = ImportProblem['code'];

/** The checks table's order; flags are always reported in it. */
export const IMPORT_PROBLEM_CODES: readonly ImportProblemCode[] = [
  'NO_CORRECT_ANSWER',
  'TOO_FEW_OPTIONS',
  'MULTIPLE_CORRECT',
  'EMPTY_PROMPT',
  'DUPLICATE_IN_TEST',
  'DUPLICATE_IN_IMPORT',
  'MISSING_FIGURE',
  'IMAGE_WITHOUT_ALT',
];

export interface CheckedDraft {
  order: number;
  prompt: string;
  options: ReadonlyArray<{ id: string; text: string }>;
  correctOptionIds: ReadonlyArray<string>;
  images: ReadonlyArray<{ path: string; alt: string }>;
  refersToFigure?: boolean;
}

const FIGURE_WORD = /\b(?:figure|diagram|graph|chart|picture|image)\b/i;

/** Whether the prompt names a figure: one of the figure words as a whole word, any case (`configure` does not). */
export function mentionsFigure(prompt: string): boolean {
  return FIGURE_WORD.test(prompt);
}

/**
 * Problems of one draft, in the checks table's order. `testQuestions` are the test's questions in order (numbered
 * from 1); `earlierPending` the import's pending drafts with a lower `order`. A duplicate in the test wins over one in
 * the import, only the first duplicate is reported, and an empty prompt is never a duplicate.
 */
export function importProblems(
  draft: CheckedDraft,
  ctx: {
    earlierPending: ReadonlyArray<Pick<CheckedDraft, 'order' | 'prompt'>>;
    testQuestions: ReadonlyArray<{ prompt: string }>;
  },
): ImportProblem[] {
  const problems: ImportProblem[] = questionProblems(draft, ctx.testQuestions).map((p) =>
    p.code === 'DUPLICATE' ? { code: 'DUPLICATE_IN_TEST', of: p.of } : p,
  );
  const prompt = normalizePrompt(draft.prompt);
  if (prompt !== '' && !problems.some((p) => p.code === 'DUPLICATE_IN_TEST')) {
    const earlier = ctx.earlierPending
      .filter((d) => d.order < draft.order && normalizePrompt(d.prompt) === prompt)
      .sort((a, b) => a.order - b.order)[0];
    if (earlier) problems.push({ code: 'DUPLICATE_IN_IMPORT', of: earlier.order });
  }
  if ((draft.refersToFigure === true || mentionsFigure(draft.prompt)) && draft.images.length === 0) {
    problems.push({ code: 'MISSING_FIGURE' });
  }
  const rank = (p: ImportProblem) => IMPORT_PROBLEM_CODES.indexOf(p.code);
  return problems.sort((a, b) => rank(a) - rank(b));
}

/** The reason text shown for a flag (IMP-10), exactly as in the checks table. */
export function importProblemText(p: ImportProblem): string {
  switch (p.code) {
    case 'NO_CORRECT_ANSWER':
      return 'No correct answer found in the source.';
    case 'TOO_FEW_OPTIONS':
      return 'A question needs at least two options.';
    case 'MULTIPLE_CORRECT':
      return 'More than one option is marked correct.';
    case 'EMPTY_PROMPT':
      return 'The question text is empty.';
    case 'DUPLICATE_IN_TEST':
      return `This looks like a duplicate of question ${p.of} in the test.`;
    case 'DUPLICATE_IN_IMPORT':
      return `This looks like a duplicate of imported question ${p.of}.`;
    case 'MISSING_FIGURE':
      return "The question refers to a figure that wasn't found.";
    case 'IMAGE_WITHOUT_ALT':
      return `Image ${p.image} has no alt text.`;
  }
}

/** A draft's stored flags: each problem's code and text, in order. */
export function importFlags(
  draft: CheckedDraft,
  ctx: Parameters<typeof importProblems>[1],
): Array<{ code: ImportProblemCode; text: string }> {
  return importProblems(draft, ctx).map((p) => ({ code: p.code, text: importProblemText(p) }));
}
