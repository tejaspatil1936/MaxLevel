import { describe, expect, it } from 'vitest';
import {
  questionCreateSchema,
  questionImportSchema,
  questionPatchSchema,
  questionSchema,
  studentQuestionSchema,
} from './question';

const body = {
  prompt: 'What is 2 + 2?',
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  correctOptionIds: ['b'],
};

describe('question request schemas', () => {
  it('Q-01 a new question needs a prompt and options; tags, images and the answer default to empty', () => {
    expect(questionCreateSchema.parse({ prompt: 'Q', options: [] })).toEqual({
      prompt: 'Q',
      options: [],
      correctOptionIds: [],
      tags: [],
      images: [],
    });
    expect(questionCreateSchema.safeParse({ options: [] }).success).toBe(false);
    expect(questionCreateSchema.safeParse({ ...body, status: 'approved' }).success, 'status is derived').toBe(false);
  });

  it('Q-01 options are at most six with unique IDs', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, text: String(i) }));
    expect(questionCreateSchema.safeParse({ ...body, options: seven }).success).toBe(false);
    const twice = [
      { id: 'a', text: '1' },
      { id: 'a', text: '2' },
    ];
    expect(questionCreateSchema.safeParse({ ...body, options: twice }).success).toBe(false);
  });

  it('Q-01 a patch changes at least one field and null clears an optional one', () => {
    expect(questionPatchSchema.safeParse({}).success).toBe(false);
    expect(questionPatchSchema.parse({ explanation: null, marks: null })).toEqual({ explanation: null, marks: null });
    expect(questionPatchSchema.safeParse({ prompt: null }).success).toBe(false);
  });

  it('Q-01 an import holds 1 to 1000 questions, each a valid create request', () => {
    expect(questionImportSchema.parse({ questions: [body] }).questions[0]).toMatchObject({ tags: [], images: [] });
    expect(questionImportSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(questionImportSchema.safeParse({ questions: [{ ...body, options: 'a' }] }).success).toBe(false);
  });
});

describe('student question schema', () => {
  it('DATA-05 parsing a stored question for a student strips the answer key and the explanation', () => {
    const stored = questionSchema.parse({
      ...body,
      id: 'q1',
      testId: 't1',
      order: 1,
      type: 'single',
      images: [],
      explanation: 'Add them.',
      tags: [],
      source: { kind: 'manual' },
      status: 'approved',
    });
    const forStudent = studentQuestionSchema.parse(stored);
    expect(forStudent).not.toHaveProperty('correctOptionIds');
    expect(forStudent).not.toHaveProperty('explanation');
    expect(forStudent).toMatchObject({ id: 'q1', prompt: 'What is 2 + 2?' });
  });
});
