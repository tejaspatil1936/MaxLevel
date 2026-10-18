import { describe, expect, it } from 'vitest';
import { importedToQuestionInput, parseQuestionJson, type ImportedQuestion } from './questions-json';

/** The first questions of legacy/data/infosys/infosys-set-2.json, copied as they are. */
const legacySample = {
  questions: [
    {
      id: 'q1',
      text: 'What is the compound interest on Rs. 20,000 at 10% per annum for 2 years, compounded annually?',
      options: ['Rs. 4,000', 'Rs. 6,620', 'Rs. 4,200', 'Rs. 24,200'],
      correctIndex: 2,
      explanation: 'Amount = 20,000 x 1.1 x 1.1 = 24,200, so CI = 24,200 - 20,000 = Rs. 4,200.',
      topic: 'Quantitative: Compound interest',
      source: 'Original (Infosys-style)',
    },
    {
      id: 'q2',
      text: 'A 40-litre mixture contains milk and water in the ratio 3 : 1. How much water must be added to make the ratio 3 : 2?',
      options: ['10 litres', '20 litres', '5 litres', '15 litres'],
      correctIndex: 0,
      explanation:
        'Milk = 30 L and water = 10 L. For a 3 : 2 ratio with 30 L of milk, water must be 20 L, so 20 - 10 = 10 L must be added.',
      topic: 'Quantitative: Mixtures',
      source: 'Original (Infosys-style)',
    },
    {
      id: 'q3',
      text: 'A boat covers 36 km downstream in 3 hours and returns the same distance upstream in 4.5 hours. What is the speed of the stream?',
      options: ['10 km/h', '4 km/h', '2.5 km/h', '2 km/h'],
      correctIndex: 3,
      explanation:
        'Downstream speed = 36/3 = 12 km/h. Upstream speed = 36/4.5 = 8 km/h. Speed of stream = (12 - 8) / 2 = 2 km/h.',
      topic: 'Quantitative: Boats and streams',
      source: 'Original (Infosys-style)',
    },
  ],
};

const handWritten = {
  format: 'mitaoe-questions/1',
  questions: [
    {
      prompt: 'What is 15% of 200?',
      options: ['25', '30', '35', '40'],
      correct: 'B',
      explanation: '15 / 100 × 200 = 30.',
      difficulty: 'easy',
      marks: 2,
      negativeMarks: 0.5,
      tags: ['percentages'],
      timeLimitSec: 60,
    },
    { prompt: 'Which are prime?', options: ['21', '23', '25', '29'], correct: ['b', 'D'] },
    { prompt: 'If $x + 3 = 7$, what is $x$?', options: ['3', '4'] },
  ],
};

const questions = (json: unknown) => {
  const parsed = parseQuestionJson(json);
  if ('error' in parsed) throw new Error('expected questions');
  return parsed.questions;
};

describe('parseQuestionJson', () => {
  it('Q-01 maps the legacy format: text, options, correctIndex, explanation, and topic as the only tag', () => {
    const [first, second, third] = questions(legacySample);
    expect(first).toEqual({
      prompt: legacySample.questions[0]!.text,
      options: ['Rs. 4,000', 'Rs. 6,620', 'Rs. 4,200', 'Rs. 24,200'],
      correct: [2],
      explanation: legacySample.questions[0]!.explanation,
      tags: ['Quantitative: Compound interest'],
    });
    expect([second!.correct, third!.correct]).toEqual([[0], [3]]);
    expect(first).not.toHaveProperty('id');
    expect(first).not.toHaveProperty('source');
  });

  it('Q-01 a missing or out-of-range legacy correctIndex gives no correct answer', () => {
    const base = { text: 'Pick one', options: ['a', 'b', 'c'] };
    const parsed = questions({
      questions: [base, { ...base, correctIndex: 3 }, { ...base, correctIndex: -1 }, { ...base, correctIndex: '1' }],
    });
    expect(parsed.map((q) => q.correct)).toEqual([[], [], [], []]);
    expect(parsed[0]).toEqual({ prompt: 'Pick one', options: ['a', 'b', 'c'], correct: [], tags: [] });
  });

  it('Q-01 maps mitaoe-questions/1: the correct letter or letters become indexes, optional fields are kept', () => {
    const [first, second, third] = questions(handWritten);
    expect(first).toEqual({
      prompt: 'What is 15% of 200?',
      options: ['25', '30', '35', '40'],
      correct: [1],
      explanation: '15 / 100 × 200 = 30.',
      difficulty: 'easy',
      marks: 2,
      negativeMarks: 0.5,
      tags: ['percentages'],
      timeLimitSec: 60,
    });
    expect(second!.correct).toEqual([1, 3]);
    expect(third).toEqual({ prompt: 'If $x + 3 = 7$, what is $x$?', options: ['3', '4'], correct: [], tags: [] });
  });

  it('Q-01 anything else is INVALID', () => {
    const invalid = [
      null,
      'questions',
      [],
      {},
      { questions: [] },
      { questions: 'q1' },
      { questions: [{ options: ['a', 'b'] }] },
      { questions: [{ text: 'No options' }] },
      { questions: [{ text: 'Bad options', options: [1, 2] }] },
      { format: 'mitaoe-questions/2', questions: handWritten.questions },
      { format: 'mitaoe-questions/1', questions: [{ text: 'Legacy keys', options: ['a', 'b'] }] },
      { format: 'mitaoe-questions/1', questions: [{ prompt: 'Bad letter', options: ['a', 'b'], correct: 'Z' }] },
      { format: 'mitaoe-questions/1', questions: [{ prompt: 'Bad level', options: ['a', 'b'], difficulty: 'tricky' }] },
    ];
    for (const json of invalid) expect(parseQuestionJson(json), JSON.stringify(json)).toEqual({ error: 'INVALID' });
  });
});

describe('importedToQuestionInput', () => {
  it('Q-01 an imported question becomes a create request with options a to f and empty options dropped', () => {
    const q: ImportedQuestion = { prompt: 'Pick', options: ['one', ' ', 'three'], correct: [2], tags: ['t'] };
    expect(importedToQuestionInput(q)).toEqual({
      prompt: 'Pick',
      options: [
        { id: 'a', text: 'one' },
        { id: 'b', text: 'three' },
      ],
      correctOptionIds: ['b'],
      tags: ['t'],
      images: [],
    });
  });
});
