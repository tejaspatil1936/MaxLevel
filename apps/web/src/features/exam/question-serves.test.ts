import { describe, expect, it } from 'vitest';
import { createServeTracker } from './question-serves';

function harness(results: Array<'ok' | 'fail' | 'final'>) {
  const sent: string[] = [];
  const served: Array<[string, number]> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const tracker = createServeTracker({
    send: async (id) => {
      sent.push(id);
      const r = results.shift() ?? 'ok';
      if (r === 'ok') return { servedAt: 1000 + sent.length };
      throw new Error(r);
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onServed: (id, at) => served.push([id, at]),
    final: (e) => (e as Error).message === 'final',
  });
  return { tracker, sent, served, timers };
}

describe('question serve reports', () => {
  it('Q-12 reports each timed question once and passes on the server’s serve time', async () => {
    const { tracker, sent, served } = harness(['ok', 'ok']);
    tracker.serve('q1');
    tracker.serve('q1');
    tracker.serve('q2');
    await tracker.settled();
    expect(sent).toEqual(['q1', 'q2']);
    expect(served).toEqual([
      ['q1', 1001],
      ['q2', 1002],
    ]);
  });

  it('Q-12 retries a failed report with the sync backoff, but not a final refusal, and stops when disposed', async () => {
    const { tracker, sent, served, timers } = harness(['fail', 'fail', 'ok', 'final']);
    tracker.serve('q1');
    await tracker.settled();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers[0]!.fn();
    await tracker.settled();
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);
    timers[1]!.fn();
    await tracker.settled();
    expect(served).toEqual([['q1', 1003]]);

    tracker.serve('q2');
    await tracker.settled();
    expect(timers, 'a final refusal is not retried').toHaveLength(2);
    expect(sent).toEqual(['q1', 'q1', 'q1', 'q2']);

    const other = harness(['fail']);
    other.tracker.serve('q1');
    await other.tracker.settled();
    other.tracker.dispose();
    expect(other.timers[0]!.cancelled).toBe(true);
  });
});
