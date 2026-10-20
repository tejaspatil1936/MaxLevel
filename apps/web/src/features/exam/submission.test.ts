import { describe, expect, it } from 'vitest';
import { createSubmission, type SubmitPhase, type SubmitReason } from './submission';

function harness() {
  let flushed!: () => void;
  const flush = new Promise<void>((r) => (flushed = r));
  const sent: SubmitReason[] = [];
  const replies: Array<{ ok: () => void; fail: (e: unknown) => void }> = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const phases: SubmitPhase[] = [];
  const deadlines: number[] = [];
  let done = 0;
  const submission = createSubmission({
    flush: () => flush,
    send: (reason) =>
      new Promise((resolve, reject) => {
        sent.push(reason);
        replies.push({ ok: () => resolve({}), fail: reject });
      }),
    retryable: (e) => e === 'network',
    finished: (e) => e === 'finished',
    notYet: (e) => (typeof e === 'number' ? e : null),
    onDeadline: (at) => deadlines.push(at),
    schedule: (fn, ms) => {
      const timer = {
        ms,
        fn: () => {
          timers.splice(timers.indexOf(timer), 1);
          fn();
        },
      };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    onPhase: (p) => phases.push(p),
    onDone: () => done++,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { submission, flushed, sent, replies, timers, phases, deadlines, settle, done: () => done };
}

describe('submission', () => {
  it('EX-15 sends nothing until every answer is synced, then submits once', async () => {
    const h = harness();
    void h.submission.submit();
    void h.submission.submit();
    await h.settle();
    expect(h.sent, 'no submit while answers wait').toEqual([]);
    expect(h.phases).toEqual(['saving']);
    h.flushed();
    await h.settle();
    expect(h.sent).toEqual([undefined]);
    h.replies[0]!.ok();
    await h.settle();
    expect(h.phases).toEqual(['saving', 'sending', 'done']);
    expect(h.done()).toBe(1);
  });

  it('EX-15 says it is offline and retries with the sync backoff, at once when the connection returns', async () => {
    const h = harness();
    h.flushed();
    void h.submission.submit();
    await h.settle();
    h.replies[0]!.fail('network');
    await h.settle();
    expect(h.phases.at(-1)).toBe('offline');
    expect(h.timers.map((t) => t.ms)).toEqual([1000]);
    h.timers[0]!.fn();
    await h.settle();
    h.replies[1]!.fail('network');
    await h.settle();
    expect(h.timers.map((t) => t.ms)).toEqual([2000]);
    h.submission.retryNow();
    expect(h.timers, 'the waiting retry is replaced').toEqual([]);
    await h.settle();
    h.replies[2]!.ok();
    await h.settle();
    expect(h.sent).toHaveLength(3);
    expect(h.done()).toBe(1);
  });

  it('EX-16 submits with time_up; an attempt already finished counts as done; a refusal can be tried again', async () => {
    const h = harness();
    h.flushed();
    void h.submission.submit('time_up');
    await h.settle();
    expect(h.sent).toEqual(['time_up']);
    h.replies[0]!.fail('finished');
    await h.settle();
    expect(h.done()).toBe(1);

    const r = harness();
    r.flushed();
    void r.submission.submit();
    await r.settle();
    r.replies[0]!.fail('bad request');
    await r.settle();
    expect(r.phases.at(-1)).toBe('failed');
    expect(r.timers).toEqual([]);
    void r.submission.submit();
    await r.settle();
    expect(r.sent).toHaveLength(2);
  });

  it('EX-16 OPS-06 a time-up refused as early takes the stored deadline and can submit again at it', async () => {
    const h = harness();
    h.flushed();
    void h.submission.submit('time_up');
    await h.settle();
    h.replies[0]!.fail(1_600_000);
    await h.settle();
    expect(h.deadlines).toEqual([1_600_000]);
    expect(h.phases.at(-1)).toBe('idle');
    expect(h.timers, 'no retry').toEqual([]);
    expect(h.done()).toBe(0);
    void h.submission.submit('time_up');
    await h.settle();
    expect(h.sent).toEqual(['time_up', 'time_up']);
  });

  it('EX-15 closing the summary stops a waiting submission', async () => {
    const h = harness();
    const pending = h.submission.submit();
    h.submission.cancel();
    h.flushed();
    await pending;
    expect(h.sent).toEqual([]);
    expect(h.phases).toEqual(['saving', 'idle']);
  });
});
