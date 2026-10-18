import type { AnswerBatch, AnswerBatchResult } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { createAnswerSync, type SyncStatus } from './answer-sync';

/** A controllable transport and timer: each send waits until the test resolves or rejects it. */
function harness(storedSeq: Record<string, number> = {}) {
  const sent: AnswerBatch[] = [];
  const replies: Array<{ ok: () => void; fail: (e?: unknown) => void }> = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const statuses: SyncStatus[] = [];
  const sync = createAnswerSync(storedSeq, {
    send: (batch) =>
      new Promise<AnswerBatchResult>((resolve, reject) => {
        sent.push(batch);
        replies.push({
          ok: () => resolve({ saved: batch.answers.map((a) => a.questionId), stale: [], rejected: [], serverTime: 0 }),
          fail: (e = new TypeError('Failed to fetch')) => reject(e),
        });
      }),
    now: () => 1000.4,
    clockOffsetMs: () => -12.6,
    schedule: (fn, ms) => {
      const timer = { ms, fn };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    onStatus: (s) => statuses.push(s),
    isPermanent: (e) => e === 'refused',
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { sync, sent, replies, timers, statuses, settle, last: () => statuses.at(-1) };
}

describe('answer sync', () => {
  it('EX-10 EX-11 each change gets the next seq after the stored one and an offset-corrected timestamp', async () => {
    const h = harness({ q1: 4 });
    h.sync.record('q1', 'a', false);
    expect(h.sent[0]).toEqual({
      answers: [{ questionId: 'q1', optionId: 'a', seq: 5, clientTs: 1000, markedForReview: false }],
      backlog: 1,
      clockOffsetMs: -13,
    });
    expect(h.last()).toEqual({ kind: 'saving' });
    h.replies[0]!.ok();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'saved' });
    expect(h.sync.waiting()).toBe(0);
  });

  it('EX-11 changes made while a batch is in flight go together in the next batch, newest per question only', async () => {
    const h = harness();
    h.sync.record('q1', 'a', false);
    h.sync.record('q1', 'b', false);
    h.sync.record('q2', null, true);
    h.sync.record('q1', 'c', true);
    expect(h.sent).toHaveLength(1);
    h.replies[0]!.ok();
    await h.settle();
    expect(h.sent[1]!.answers).toEqual([
      { questionId: 'q1', optionId: 'c', seq: 3, clientTs: 1000, markedForReview: true },
      { questionId: 'q2', optionId: null, seq: 1, clientTs: 1000, markedForReview: true },
    ]);
    h.replies[1]!.ok();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'saved' });
  });

  it('EX-12 a failed batch shows the waiting count and retries after 1, 2, 4, 8 and then 15 seconds', async () => {
    const h = harness();
    h.sync.record('q1', 'a', false);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.replies[i]!.fail();
      await h.settle();
      expect(h.last()).toEqual({ kind: 'offline', waiting: i === 0 ? 1 : 2 });
      const timer = h.timers.shift()!;
      delays.push(timer.ms);
      if (i === 0) {
        h.sync.record('q2', 'b', false);
        expect(h.sent, 'a change waits for the retry').toHaveLength(1);
      }
      timer.fn();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(h.sent[6]!.answers.map((a) => a.questionId)).toEqual(['q1', 'q2']);
    h.replies[6]!.ok();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'saved' });
  });

  it('EX-11 a refused batch is dropped instead of retried, and dispose cancels a waiting retry', async () => {
    const h = harness();
    h.sync.record('q1', 'a', false);
    h.replies[0]!.fail('refused');
    await h.settle();
    expect(h.timers).toHaveLength(0);
    expect(h.last()).toEqual({ kind: 'saved' });

    h.sync.record('q2', 'a', false);
    h.replies[1]!.fail();
    await h.settle();
    expect(h.timers).toHaveLength(1);
    h.sync.dispose();
    expect(h.timers).toHaveLength(0);
  });
});
