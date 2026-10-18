import type { Question } from './question';

// Question checks (DECISIONS Q17, A11Y-10, IMP-09). No problem: stored `approved`; any problem: stored `draft`.

export type QuestionProblem =
  | { code: 'NO_CORRECT_ANSWER' }
  | { code: 'TOO_FEW_OPTIONS' }
  | { code: 'EMPTY_PROMPT' }
  | { code: 'MULTIPLE_CORRECT' }
  | { code: 'DUPLICATE'; of: number }
  | { code: 'IMAGE_WITHOUT_ALT'; image: number };

/** Prompts compared for duplicates: case, spacing and closing punctuation ignored (symbols inside matter: 2+3, 2-3). */
const normalize = (prompt: string) =>
  prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s?.!:]+$/, '');

/**
 * Problems of one question, in the order of the checks table. `others` are the test's questions in order,
 * numbered from 1 for DUPLICATE; the question being checked is not among them (an editor can pass its own slot
 * with an empty prompt to keep the numbering). Only the first duplicate is reported.
 */
export function questionProblems(
  q: Pick<Question, 'prompt' | 'options' | 'correctOptionIds' | 'images'>,
  others: ReadonlyArray<Pick<Question, 'prompt'>>,
): QuestionProblem[] {
  const problems: QuestionProblem[] = [];
  const optionIds = new Set(q.options.filter((o) => o.text.trim() !== '').map((o) => o.id));
  const correct = q.correctOptionIds.filter((id) => optionIds.has(id));
  if (correct.length === 0) problems.push({ code: 'NO_CORRECT_ANSWER' });
  if (optionIds.size < 2) problems.push({ code: 'TOO_FEW_OPTIONS' });
  const prompt = normalize(q.prompt);
  if (prompt === '') problems.push({ code: 'EMPTY_PROMPT' });
  if (correct.length > 1) problems.push({ code: 'MULTIPLE_CORRECT' });
  if (prompt !== '') {
    const dup = others.findIndex((o) => normalize(o.prompt) === prompt);
    if (dup >= 0) problems.push({ code: 'DUPLICATE', of: dup + 1 });
  }
  q.images.forEach((img, i) => {
    if (img.alt.trim() === '') problems.push({ code: 'IMAGE_WITHOUT_ALT', image: i + 1 });
  });
  return problems;
}

/** The reason text shown for a problem (docs/testids/phase-2.md, question checks). */
export function problemText(p: QuestionProblem): string {
  switch (p.code) {
    case 'NO_CORRECT_ANSWER':
      return 'No correct answer is set.';
    case 'TOO_FEW_OPTIONS':
      return 'A question needs at least two options.';
    case 'EMPTY_PROMPT':
      return 'The question text is empty.';
    case 'MULTIPLE_CORRECT':
      return 'More than one option is marked correct.';
    case 'DUPLICATE':
      return `This looks like a duplicate of question ${p.of}.`;
    case 'IMAGE_WITHOUT_ALT':
      return `Image ${p.image} has no alt text.`;
  }
}
