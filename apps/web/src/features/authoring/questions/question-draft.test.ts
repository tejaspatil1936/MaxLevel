import type { Question } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { draftErrors, draftFrom, draftProblems, draftToCreate, draftToPatch, nextOptionId } from './question-draft';

const stored: Question = {
  id: 'q2',
  testId: 't1',
  order: 2,
  type: 'single',
  prompt: 'What is 15% of 200?',
  images: [{ path: 'organizations/o/tests/t1/images/x.png', alt: 'A chart' }],
  options: [
    { id: 'a', text: '25' },
    { id: 'b', text: '30' },
  ],
  correctOptionIds: ['b'],
  explanation: '15 / 100 × 200 = 30.',
  marks: 2,
  difficulty: 'medium',
  tags: ['percentages', 'quant'],
  source: { kind: 'manual' },
  status: 'approved',
  problems: [],
};

describe('question editor draft', () => {
  it('Q-01 a new question starts with four empty options and nothing set', () => {
    const d = draftFrom();
    expect(d.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(d).toMatchObject({ prompt: '', correct: '', difficulty: '', marks: '', tags: '', images: [] });
    expect(nextOptionId(d.options)).toBe('e');
    expect(
      nextOptionId([
        { id: 'a', text: '' },
        { id: 'c', text: '' },
      ]),
    ).toBe('b');
  });

  it('Q-01 an edit starts from the stored question, with image URLs from the list', () => {
    const d = draftFrom(stored, { 'organizations/o/tests/t1/images/x.png': 'data:image/png;base64,AA' });
    expect(d).toMatchObject({ correct: 'b', marks: '2', negativeMarks: '', tags: 'percentages, quant' });
    expect(d.images).toEqual([{ path: stored.images[0]!.path, alt: 'A chart', src: 'data:image/png;base64,AA' }]);
  });

  it('Q-01 Q-07 empty rows are dropped, empty numbers mean not set, and tags split at commas', () => {
    const d = {
      ...draftFrom(),
      prompt: 'Q',
      options: [
        { id: 'a', text: ' 3 ' },
        { id: 'b', text: '' },
        { id: 'c', text: '4' },
      ],
      correct: 'b',
      tags: 'algebra, , algebra,  linear ',
      marks: '',
      negativeMarks: '0',
    };
    expect(draftToCreate(d)).toEqual({
      prompt: 'Q',
      options: [
        { id: 'a', text: '3' },
        { id: 'c', text: '4' },
      ],
      correctOptionIds: [],
      negativeMarks: 0,
      tags: ['algebra', 'linear'],
      images: [],
    });
    expect(draftToPatch(d)).toMatchObject({ marks: null, explanation: null, sectionId: null, negativeMarks: 0 });
  });

  it('Q-01 A11Y-10 the live checks name each problem, numbering a duplicate by its position', () => {
    const d = { ...draftFrom(stored), correct: '', images: [{ path: 'p', alt: ' ', src: null }] };
    expect(draftProblems(d, [{ prompt: 'what is 15% of 200' }, { prompt: '' }])).toEqual([
      { code: 'NO_CORRECT_ANSWER' },
      { code: 'DUPLICATE', of: 1 },
      { code: 'IMAGE_WITHOUT_ALT', image: 1 },
    ]);
    expect(draftProblems(draftFrom(stored), [])).toEqual([]);
  });

  it('Q-07 Q-10 marks must be positive, negative marks 0 or more, and a time limit whole seconds', () => {
    expect(draftErrors({ ...draftFrom(), marks: '0', negativeMarks: '-1', timeLimit: '1.5' })).toEqual({
      marks: 'questions.marksInvalid',
      negativeMarks: 'questions.negativeInvalid',
      timeLimit: 'questions.timeLimitInvalid',
    });
    expect(draftErrors({ ...draftFrom(), marks: '2', negativeMarks: '0.5', timeLimit: '60' })).toEqual({});
  });
});
