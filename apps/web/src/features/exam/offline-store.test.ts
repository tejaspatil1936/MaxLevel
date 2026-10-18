import { describe, expect, it } from 'vitest';
import { mergeDeviceAnswers, type DeviceAnswer } from './offline-store';

const kept = (questionId: string, seq: number, state: DeviceAnswer['state'], optionId: string | null = 'a') => ({
  attemptId: 'att-1',
  questionId,
  optionId,
  seq,
  clientTs: 1000 + seq,
  markedForReview: optionId === null,
  state,
});

describe('device answers', () => {
  it('US-ST-05 EX-10 newer device answers replace the payload’s and those not yet accepted wait to be sent', () => {
    const { answers, waiting } = mergeDeviceAnswers({ q1: { optionId: 'b', seq: 2 }, q2: { optionId: 'c', seq: 4 } }, [
      kept('q1', 3, 'waiting'),
      kept('q2', 4, 'waiting', 'd'), // the server already has seq 4: stale, not resent
      kept('q3', 1, 'saved', null),
      kept('q4', 2, 'rejected'),
    ]);
    expect(answers).toEqual({
      q1: { optionId: 'a', seq: 3 },
      q2: { optionId: 'c', seq: 4 },
      q3: { optionId: null, seq: 1, markedForReview: true },
    });
    expect(waiting).toEqual([{ questionId: 'q1', optionId: 'a', seq: 3, clientTs: 1003, markedForReview: false }]);
  });
});
