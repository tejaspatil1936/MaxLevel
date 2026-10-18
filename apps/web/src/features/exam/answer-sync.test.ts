import type { AnswerBatch, AnswerBatchResult } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import {
  createAnswerSync,
  type LocalAnswerState,
  type PendingAnswer,
  type Rejection,
  type SyncStatus,
} from './answer-sync';

/** A controllable transport and timer: each send waits until the test resolves or rejects it. */
function harness(storedSeq: Record<string, number> = {}, waiting: PendingAnswer[] = [], online = true) {
  const sent: AnswerBatch[] = [];
  const replies: Array<{ ok: (rejected?: AnswerBatchResult['rejected']) => void; fail: (e?: unknown) => void }> = [];
  const stored: Array<[string, number, LocalAnswerState]> = [];
  const rejections: Rejection[][] = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const statuses: SyncStatus[] = [];
  const sync = createAnswerSync(
    storedSeq,
    {
      send: (batch) =>
        new Promise<AnswerBatchResult>((resolve, reject) => {
          sent.push(batch);
          replies.push({
            ok: (rejected = []) =>
              resolve({
                saved: batch.answers.map((a) => a.questionId).filter((q) => !rejected.some((r) => r.questionId === q)),
                stale: [],
                rejected,
                serverTime: 0,
              }),
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
      refusal: (e) => (e === 'refused' ? 'ATTEMPT_FINISHED' : null),
      store: (a, state) => stored.push([a.questionId, a.seq, state]),
      onRejected: (r) => rejections.push(r),
      online,
    },
    waiting,
  );
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { sync, sent, replies, timers, statuses, stored, rejections, settle, last: () => statuses.at(-1) };
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

  it('EX-10 every change goes to the device store at once as waiting, then as saved once the server has it', async () => {
    const h = harness();
    h.sync.record('q1', 'a', false);
    expect(h.stored).toEqual([['q1', 1, 'waiting']]);
    h.sync.record('q1', 'b', false);
    h.replies[0]!.ok();
    await h.settle();
    // The first send is settled, but a newer change of q1 waits, so only that one is stored, then saved.
    expect(h.stored).toEqual([
      ['q1', 1, 'waiting'],
      ['q1', 2, 'waiting'],
    ]);
    h.replies[1]!.ok();
    await h.settle();
    expect(h.stored.at(-1)).toEqual(['q1', 2, 'saved']);
  });

  it('US-ST-05 EX-11 answers kept on the device are sent first after a reload, and new changes continue their seq', async () => {
    const kept = { questionId: 'q1', optionId: 'a', seq: 3, clientTs: 900, markedForReview: false };
    const h = harness({ q1: 1 }, [kept]);
    expect(h.sent[0]!.answers).toEqual([kept]);
    expect(h.sync.waiting()).toBe(1);
    h.replies[0]!.fail();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'offline', waiting: 1 });
    h.sync.record('q1', 'b', false);
    h.timers.shift()!.fn();
    expect(h.sent[1]!.answers).toEqual([{ ...kept, optionId: 'b', seq: 4, clientTs: 1000 }]);
  });

  it('EX-13 refused answers are reported, never dropped silently, until a later change of the question is saved', async () => {
    const h = harness();
    h.sync.record('q1', 'a', false);
    h.replies[0]!.ok([{ questionId: 'q1', code: 'AFTER_DEADLINE' }]);
    await h.settle();
    expect(h.rejections.at(-1)).toEqual([{ questionId: 'q1', code: 'AFTER_DEADLINE' }]);
    expect(h.stored.at(-1)).toEqual(['q1', 1, 'rejected']);
    expect(h.last()).toEqual({ kind: 'saved' });

    // A refused batch (a 4xx that a retry can't fix) is not retried; every answer in it is reported.
    h.sync.record('q2', 'a', false);
    h.replies[1]!.fail('refused');
    await h.settle();
    expect(h.timers).toHaveLength(0);
    expect(h.rejections.at(-1)).toEqual([
      { questionId: 'q1', code: 'AFTER_DEADLINE' },
      { questionId: 'q2', code: 'ATTEMPT_FINISHED' },
    ]);

    h.sync.record('q1', 'b', false);
    h.replies[2]!.ok();
    await h.settle();
    expect(h.rejections.at(-1)).toEqual([{ questionId: 'q2', code: 'ATTEMPT_FINISHED' }]);
  });

  it('EX-12 offline with nothing waiting says so, and coming back online sends at once instead of waiting', async () => {
    const h = harness({}, [], false);
    h.sync.setOnline(false);
    expect(h.last()).toEqual({ kind: 'offline', waiting: 0 });
    h.sync.record('q1', 'a', false);
    h.replies[0]!.fail();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'offline', waiting: 1 });
    expect(h.timers).toHaveLength(1);
    h.sync.setOnline(true);
    expect(h.timers, 'the waiting retry is cancelled').toHaveLength(0);
    expect(h.sent).toHaveLength(2);
    h.replies[1]!.ok();
    await h.settle();
    expect(h.last()).toEqual({ kind: 'saved' });
  });

  it('EX-12 dispose cancels a waiting retry', async () => {
    const h = harness();
    h.sync.record('q2', 'a', false);
    h.replies[0]!.fail();
    await h.settle();
    expect(h.timers).toHaveLength(1);
    h.sync.dispose();
    expect(h.timers).toHaveLength(0);
  });
  it('EX-15 flush resolves once every waiting answer is saved and no batch is in flight, retries included', async () => {
    const h = harness();
    await h.sync.flush();
    h.sync.record('q1', 'a', false);
    let flushed = false;
    void h.sync.flush().then(() => (flushed = true));
    h.replies[0]!.fail();
    await h.settle();
    h.sync.record('q2', 'b', false);
    expect(flushed, 'waiting for the retry').toBe(false);
    h.timers[0]!.fn();
    await h.settle();
    expect(flushed, 'the retry is in flight').toBe(false);
    h.replies[1]!.ok([{ questionId: 'q2', code: 'QUESTION_TIME_UP' }]);
    await h.settle();
    expect(flushed, 'a refused answer no longer waits').toBe(true);
    expect(h.sync.waiting()).toBe(0);
  });
});
