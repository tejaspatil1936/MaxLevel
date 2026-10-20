import { describe, expect, it } from 'vitest';
import { examPayloadSchema, examPreviewSchema } from './exam';

const payload = {
  test: { id: 't1', title: 'Aptitude', dayLabel: 'Day 1' },
  durationMin: 60,
  sections: [],
  questions: [
    {
      id: 'q1',
      prompt: 'What is 15% of 200?',
      images: [],
      options: [
        { id: 'a', text: '25' },
        { id: 'b', text: '30' },
      ],
      correctOptionIds: ['b'],
      explanation: '15 / 100 × 200 = 30.',
    },
  ],
  imageUrls: {},
};

describe('exam payload', () => {
  it('DATA-05 the student payload strips the answer key and the explanation', () => {
    const parsed = examPayloadSchema.parse(payload);
    expect(JSON.stringify(parsed)).not.toContain('correctOptionIds');
    expect(JSON.stringify(parsed)).not.toContain('explanation');
  });

  it('Q-13 the admin preview payload keeps the answer key and the explanation', () => {
    const [q] = examPreviewSchema.parse(payload).questions;
    expect(q).toMatchObject({ correctOptionIds: ['b'], explanation: '15 / 100 × 200 = 30.' });
  });
});
