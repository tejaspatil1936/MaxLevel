import type { AttemptEventReport, AttemptEventResult } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { createProctorReporter, type StrikeWarning } from './proctor-events';

function harness(over: { strikesCount?: number; devtoolsPolicy?: 'block_strike' | 'block' | 'allow' } = {}) {
  let now = 1_000_000;
  const sent: AttemptEventReport[] = [];
  const replies: Array<{ ok: (r: AttemptEventResult) => void; fail: (e: unknown) => void }> = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const warnings: Array<StrikeWarning | null> = [];
  const counts: number[] = [];
  let finished = 0;
  const reporter = createProctorReporter({
    send: (report) =>
      new Promise((resolve, reject) => {
        sent.push(report);
        replies.push({ ok: resolve, fail: reject });
      }),
    now: () => now,
    schedule: (fn, ms) => {
      const timer = { ms, fn };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    devtoolsPolicy: over.devtoolsPolicy ?? 'block_strike',
    strikesCount: over.strikesCount ?? 0,
    onCount: (n) => counts.push(n),
    onWarning: (w) => warnings.push(w),
    onFinished: () => finished++,
    final: (e) => e === 'refused',
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    reporter,
    sent,
    replies,
    timers,
    warnings,
    counts,
    settle,
    finished: () => finished,
    advance: (ms: number) => (now += ms),
  };
}

const result = (
  strikesCount: number,
  counted = true,
  status: AttemptEventResult['status'] = 'in_progress',
): AttemptEventResult => ({
  strikesCount,
  counted,
  status,
});

describe('proctor event reporter', () => {
  it('PR-09 PR-08 a strike warns at once with the next number, then shows the server’s count', async () => {
    const h = harness({ strikesCount: 1 });
    h.reporter.report('fullscreen_exit', { source: 'fullscreenchange' });
    expect(h.warnings).toEqual([{ type: 'fullscreen_exit', count: 2 }]);
    expect(h.sent).toEqual([{ type: 'fullscreen_exit', clientTs: 1_000_000, details: { source: 'fullscreenchange' } }]);
    h.replies[0]!.ok(result(3));
    await h.settle();
    expect(h.warnings.at(-1)).toEqual({ type: 'fullscreen_exit', count: 3 });
    expect(h.counts).toEqual([3]);
    h.reporter.acknowledge();
    expect(h.warnings.at(-1)).toBeNull();
  });

  it('PR-07 PR-11 events within 3 seconds keep the first reason, and every event is still reported', async () => {
    const h = harness();
    h.reporter.report('window_blur');
    h.advance(100);
    h.reporter.report('tab_hidden');
    h.reporter.report('context_menu');
    expect(h.sent.map((r) => r.type)).toEqual(['window_blur', 'tab_hidden', 'context_menu']);
    expect(h.warnings).toEqual([{ type: 'window_blur', count: 1 }]);
    h.replies[1]!.ok(result(1, false));
    h.replies[0]!.ok(result(1));
    await h.settle();
    expect(h.counts).toEqual([1]);
    h.advance(3_000);
    h.reporter.report('no_face');
    expect(h.warnings.at(-1)).toEqual({ type: 'no_face', count: 2 });
  });

  it('PR-11 logged-only events never warn', () => {
    const h = harness({ devtoolsPolicy: 'block' });
    for (const type of ['devtools', 'context_menu', 'clipboard', 'print'] as const) h.reporter.report(type);
    expect(h.sent).toHaveLength(4);
    expect(h.warnings).toEqual([]);
  });

  it('PR-10 a terminated response ends the exam once and nothing more is sent', async () => {
    const h = harness({ strikesCount: 2 });
    h.reporter.report('tab_hidden');
    h.replies[0]!.ok(result(3, true, 'terminated'));
    await h.settle();
    expect(h.finished()).toBe(1);
    h.reporter.report('tab_hidden');
    expect(h.sent).toHaveLength(1);
  });

  it('PR-08 a failed report is retried with its own client time; a refusal is not', async () => {
    const h = harness();
    h.reporter.report('tab_hidden');
    h.replies[0]!.fail(new Error('network'));
    await h.settle();
    expect(h.timers.map((t) => t.ms)).toEqual([1000]);
    h.advance(1_000);
    h.timers[0]!.fn();
    expect(h.sent.map((r) => r.clientTs)).toEqual([1_000_000, 1_000_000]);
    h.replies[1]!.fail('refused');
    await h.settle();
    expect(h.timers).toHaveLength(1);
  });
});
