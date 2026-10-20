import { describe, expect, it } from 'vitest';
import {
  importFlags,
  importProblems,
  importProblemText,
  mentionsFigure,
  type CheckedDraft,
  type ImportProblem,
} from './import-checks';

const options = ['Rs. 480', 'Rs. 500', 'Rs. 505', 'Rs. 495'].map((text, i) => ({ id: 'abcd'[i]!, text }));
const valid: CheckedDraft = {
  order: 5,
  prompt: 'A shopkeeper sells an article for Rs. 550 at a profit of 10%. What was the cost price?',
  options,
  correctOptionIds: ['b'],
  images: [],
};
const none = { earlierPending: [], testQuestions: [] };
const codes = (p: ImportProblem[]) => p.map((x) => x.code);
const check = (d: Partial<CheckedDraft>, ctx: Parameters<typeof importProblems>[1] = none) =>
  importProblems({ ...valid, ...d }, ctx);

describe('importProblems', () => {
  it('IMP-09 a complete draft has no problems', () => {
    expect(check({}, { earlierPending: [{ order: 1, prompt: 'What is 15% of 200?' }], testQuestions: [] })).toEqual([]);
  });

  it('IMP-09 no correct option, or a correct ID naming a missing or empty option, is NO_CORRECT_ANSWER', () => {
    expect(codes(check({ correctOptionIds: [] }))).toEqual(['NO_CORRECT_ANSWER']);
    expect(codes(check({ correctOptionIds: ['f'] }))).toEqual(['NO_CORRECT_ANSWER']);
    const emptyB = options.map((o) => (o.id === 'b' ? { ...o, text: '  ' } : o));
    expect(codes(check({ options: emptyB }))).toEqual(['NO_CORRECT_ANSWER']);
  });

  it('IMP-09 one non-empty option is TOO_FEW_OPTIONS', () => {
    expect(codes(check({ options: [{ id: 'a', text: 'Square' }], correctOptionIds: ['a'] }))).toEqual([
      'TOO_FEW_OPTIONS',
    ]);
    const oneFilled = [
      { id: 'a', text: 'Square' },
      { id: 'b', text: '' },
    ];
    expect(codes(check({ options: oneFilled, correctOptionIds: ['a'] }))).toEqual(['TOO_FEW_OPTIONS']);
  });

  it('IMP-09 two correct options is MULTIPLE_CORRECT', () => {
    expect(codes(check({ correctOptionIds: ['a', 'b'] }))).toEqual(['MULTIPLE_CORRECT']);
  });

  it('IMP-09 an empty or whitespace-only prompt is EMPTY_PROMPT and never a duplicate', () => {
    const ctx = { earlierPending: [{ order: 1, prompt: '' }], testQuestions: [{ prompt: ' ' }] };
    expect(codes(check({ prompt: '' }, ctx))).toEqual(['EMPTY_PROMPT']);
    expect(codes(check({ prompt: ' \n\t ' }, ctx))).toEqual(['EMPTY_PROMPT']);
  });

  it('IMP-09 a prompt equal to a test question, ignoring case, spacing and closing punctuation, is DUPLICATE_IN_TEST', () => {
    const testQuestions = [
      { prompt: 'What is 15% of 200?' },
      { prompt: '  a shopkeeper sells an article for Rs. 550   at a profit of 10%.  what was the COST price' },
    ];
    expect(check({}, { earlierPending: [], testQuestions })).toEqual([{ code: 'DUPLICATE_IN_TEST', of: 2 }]);
    expect(
      check({ prompt: 'What is 2 + 3?' }, { earlierPending: [], testQuestions: [{ prompt: 'What is 2 - 3?' }] }),
    ).toEqual([]);
  });

  it('IMP-09 a prompt equal to an earlier pending draft is DUPLICATE_IN_IMPORT naming that draft; a later one does not count', () => {
    const earlierPending = [
      { order: 3, prompt: 'What is 15% of 200?' },
      { order: 1, prompt: valid.prompt.toUpperCase() },
      { order: 2, prompt: `${valid.prompt}!!` },
    ];
    expect(check({}, { earlierPending, testQuestions: [] })).toEqual([{ code: 'DUPLICATE_IN_IMPORT', of: 1 }]);
    expect(check({ order: 1 }, { earlierPending: [{ order: 8, prompt: valid.prompt }], testQuestions: [] })).toEqual(
      [],
    );
  });

  it('IMP-09 a duplicate in the test wins over a duplicate in the import', () => {
    const ctx = { earlierPending: [{ order: 1, prompt: valid.prompt }], testQuestions: [{ prompt: valid.prompt }] };
    expect(check({}, ctx)).toEqual([{ code: 'DUPLICATE_IN_TEST', of: 1 }]);
  });

  it('IMP-09 a figure word or refersToFigure without an image is MISSING_FIGURE', () => {
    for (const word of ['figure', 'Diagram', 'GRAPH', 'chart', 'picture', 'image']) {
      expect(codes(check({ prompt: `Look at the ${word} below. How many triangles?` }))).toEqual(['MISSING_FIGURE']);
    }
    expect(codes(check({ refersToFigure: true }))).toEqual(['MISSING_FIGURE']);
    const images = [{ path: 'figures/1.png', alt: 'A triangle split into smaller triangles' }];
    expect(check({ prompt: 'Refer to the figure. How many triangles?', refersToFigure: true, images })).toEqual([]);
  });

  it('IMP-09 figure words count only as whole words', () => {
    expect(mentionsFigure('How do you configure the router?')).toBe(false);
    expect(mentionsFigure('Who is a photographer?')).toBe(false);
    expect(mentionsFigure('Disfigured shapes are not counted.')).toBe(false);
    expect(mentionsFigure('The bar chart shows sales.')).toBe(true);
    expect(mentionsFigure('(see image)')).toBe(true);
    expect(codes(check({ prompt: 'How do you configure the router?' }))).toEqual([]);
  });

  it('IMP-09 an image with empty alt text is IMAGE_WITHOUT_ALT with its 1-based number', () => {
    const images = [
      { path: 'figures/1.png', alt: 'Bar chart of yearly sales' },
      { path: 'figures/2.png', alt: '' },
      { path: 'figures/3.png', alt: '  ' },
    ];
    expect(check({ images })).toEqual([
      { code: 'IMAGE_WITHOUT_ALT', image: 2 },
      { code: 'IMAGE_WITHOUT_ALT', image: 3 },
    ]);
  });

  it('IMP-09 several problems together come in the checks table order', () => {
    const one = [{ id: 'a', text: 'Yes' }];
    const all = check(
      {
        prompt: 'Refer to the diagram. Which is larger?',
        options: one,
        correctOptionIds: [],
        images: [],
      },
      { earlierPending: [{ order: 2, prompt: 'refer to the diagram. which is larger' }], testQuestions: [] },
    );
    expect(codes(all)).toEqual(['NO_CORRECT_ANSWER', 'TOO_FEW_OPTIONS', 'DUPLICATE_IN_IMPORT', 'MISSING_FIGURE']);

    const withImage = check(
      {
        prompt: 'What does the chart show?',
        correctOptionIds: ['a', 'c'],
        images: [{ path: 'figures/1.png', alt: '' }],
      },
      { earlierPending: [], testQuestions: [{ prompt: 'What does the chart show' }] },
    );
    expect(withImage).toEqual([
      { code: 'MULTIPLE_CORRECT' },
      { code: 'DUPLICATE_IN_TEST', of: 1 },
      { code: 'IMAGE_WITHOUT_ALT', image: 1 },
    ]);

    expect(codes(check({ prompt: '', options: one, correctOptionIds: ['a', 'z'], refersToFigure: true }))).toEqual([
      'TOO_FEW_OPTIONS',
      'EMPTY_PROMPT',
      'MISSING_FIGURE',
    ]);
  });

  it('IMP-09 importProblemText gives exactly the reason texts', () => {
    const problems: ImportProblem[] = [
      { code: 'NO_CORRECT_ANSWER' },
      { code: 'TOO_FEW_OPTIONS' },
      { code: 'MULTIPLE_CORRECT' },
      { code: 'EMPTY_PROMPT' },
      { code: 'DUPLICATE_IN_TEST', of: 2 },
      { code: 'DUPLICATE_IN_IMPORT', of: 1 },
      { code: 'MISSING_FIGURE' },
      { code: 'IMAGE_WITHOUT_ALT', image: 3 },
    ];
    expect(problems.map(importProblemText)).toEqual([
      'No correct answer found in the source.',
      'A question needs at least two options.',
      'More than one option is marked correct.',
      'The question text is empty.',
      'This looks like a duplicate of question 2 in the test.',
      'This looks like a duplicate of imported question 1.',
      "The question refers to a figure that wasn't found.",
      'Image 3 has no alt text.',
    ]);
  });

  it('IMP-09 importFlags pairs each problem code with its text', () => {
    expect(importFlags({ ...valid, correctOptionIds: [] }, none)).toEqual([
      { code: 'NO_CORRECT_ANSWER', text: 'No correct answer found in the source.' },
    ]);
  });
});
