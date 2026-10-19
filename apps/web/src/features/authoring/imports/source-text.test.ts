import { describe, expect, it } from 'vitest';
import { findQuestion } from './source-text';

describe('findQuestion', () => {
  const part = '# Reasoning\n\n1. Find the next number: 3, 6, 12, 24, ...\n(a) 30 (b) 36\n';

  it('IMP-11 finds the question as stored, or without its outer whitespace', () => {
    expect(findQuestion(part, 'Find the next number: 3, 6, 12, 24, ...')).toEqual({ start: 16, end: 55 });
    expect(findQuestion(part, '  Find the next number: 3, 6, 12, 24, ...\n')).toEqual({ start: 16, end: 55 });
    expect(findQuestion('Question: What is 2 + 2?\nOption A: 4', 'What is 2 + 2?')).toEqual({ start: 10, end: 24 });
  });

  it('IMP-11 gives null for a question the part does not hold, and for an empty one', () => {
    expect(findQuestion(part, 'Which statement must be true?')).toBeNull();
    expect(findQuestion(part, '   ')).toBeNull();
  });
});
