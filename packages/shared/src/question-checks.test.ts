import { describe, expect, it } from 'vitest';
import { questionSchema, studentQuestionSchema } from './question';
import { problemText, questionProblems, type QuestionProblem } from './question-checks';

const options = ['20 m/s', '24 m/s', '18 m/s', '22 m/s'].map((text, i) => ({ id: 'abcd'[i]!, text }));
const valid = {
  prompt: 'A train 240 m long passes a pole in 12 seconds. What is its speed?',
  options,
  correctOptionIds: ['a'],
  images: [] as Array<{ path: string; alt: string }>,
};
const codes = (p: QuestionProblem[]) => p.map((x) => x.code);

describe('questionProblems', () => {
  it('Q-01 a complete question has no problems', () => {
    expect(questionProblems(valid, [{ prompt: 'What is 15% of 200?' }])).toEqual([]);
  });

  it('Q-01 no correct answer, or one pointing at a missing or empty option, is NO_CORRECT_ANSWER', () => {
    expect(codes(questionProblems({ ...valid, correctOptionIds: [] }, []))).toEqual(['NO_CORRECT_ANSWER']);
    expect(codes(questionProblems({ ...valid, correctOptionIds: ['z'] }, []))).toEqual(['NO_CORRECT_ANSWER']);
    const emptyA = options.map((o) => (o.id === 'a' ? { ...o, text: ' ' } : o));
    expect(codes(questionProblems({ ...valid, options: emptyA }, []))).toEqual(['NO_CORRECT_ANSWER']);
  });

  it('Q-01 fewer than two non-empty options is TOO_FEW_OPTIONS', () => {
    const one = [options[0]!, { id: 'b', text: '' }];
    expect(codes(questionProblems({ ...valid, options: one }, []))).toEqual(['TOO_FEW_OPTIONS']);
  });

  it('Q-01 an empty prompt is EMPTY_PROMPT and never a duplicate', () => {
    expect(codes(questionProblems({ ...valid, prompt: '   ' }, [{ prompt: '' }]))).toEqual(['EMPTY_PROMPT']);
  });

  it('Q-01 more than one correct option is MULTIPLE_CORRECT', () => {
    expect(codes(questionProblems({ ...valid, correctOptionIds: ['a', 'b'] }, []))).toEqual(['MULTIPLE_CORRECT']);
  });

  it('Q-01 a prompt equal to another question, ignoring case and spacing, is a DUPLICATE of its number', () => {
    const others = [
      { prompt: 'What is 15% of 200?' },
      { prompt: '  a train 240 m long passes a pole in 12  seconds. What is its speed' },
    ];
    expect(questionProblems(valid, others)).toEqual([{ code: 'DUPLICATE', of: 2 }]);
    expect(questionProblems({ ...valid, prompt: 'What is 2 + 3?' }, [{ prompt: 'What is 2 - 3?' }])).toEqual([]);
  });

  it('Q-01 an image without alt text is IMAGE_WITHOUT_ALT with its number', () => {
    const images = [
      { path: 'a.png', alt: 'A train' },
      { path: 'b.png', alt: ' ' },
    ];
    expect(questionProblems({ ...valid, images }, [])).toEqual([{ code: 'IMAGE_WITHOUT_ALT', image: 2 }]);
  });

  it('Q-01 problemText gives the exact reason texts', () => {
    expect(
      [
        { code: 'NO_CORRECT_ANSWER' },
        { code: 'TOO_FEW_OPTIONS' },
        { code: 'EMPTY_PROMPT' },
        { code: 'MULTIPLE_CORRECT' },
        { code: 'DUPLICATE', of: 3 },
        { code: 'IMAGE_WITHOUT_ALT', image: 1 },
      ].map((p) => problemText(p as QuestionProblem)),
    ).toEqual([
      'No correct answer is set.',
      'A question needs at least two options.',
      'The question text is empty.',
      'More than one option is marked correct.',
      'This looks like a duplicate of question 3.',
      'Image 1 has no alt text.',
    ]);
  });
});

describe('studentQuestionSchema', () => {
  it('Q-01 the student view of a question strips the answer key and the explanation', () => {
    const full = questionSchema.parse({
      ...valid,
      id: 'q1',
      testId: 't1',
      order: 1,
      type: 'single',
      explanation: 'Speed is distance over time: 240 / 12 = 20 m/s.',
      tags: [],
      source: { kind: 'manual' },
      status: 'approved',
    });
    const student = studentQuestionSchema.parse(full);
    expect(student).not.toHaveProperty('correctOptionIds');
    expect(student).not.toHaveProperty('explanation');
    expect(Object.keys(studentQuestionSchema.shape)).not.toEqual(expect.arrayContaining(['correctOptionIds']));
    expect(Object.keys(studentQuestionSchema.shape)).not.toEqual(expect.arrayContaining(['explanation']));
  });
});
