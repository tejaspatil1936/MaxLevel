import { describe, expect, it } from 'vitest';
import { installInputGuard, type GuardEvent } from './input-guard';

function harness() {
  const listeners = new Map<string, (e: GuardEvent) => void>();
  const reports: unknown[] = [];
  const remove = installInputGuard({
    doc: {
      addEventListener: (type, fn) => void listeners.set(type, fn),
      removeEventListener: (type) => void listeners.delete(type),
    },
    report: (type, details) => reports.push({ type, details }),
  });
  const fire = (type: string, isTrusted: boolean, target: unknown = null) => {
    const e = { type, isTrusted, target, stopped: false, prevented: false } as GuardEvent & {
      stopped: boolean;
      prevented: boolean;
    };
    e.stopImmediatePropagation = () => void (e.stopped = true);
    e.preventDefault = () => void (e.prevented = true);
    listeners.get(type)?.(e);
    return e;
  };
  return { fire, reports, remove, listeners };
}

const radio = { matches: (s: string) => s === 'input[type="radio"]', closest: () => null };
const optionText = { matches: () => false, closest: () => ({ querySelector: () => ({}) }) };
const submitButton = { matches: () => false, closest: () => null };

describe('installInputGuard', () => {
  it('a person’s keys and clicks pass untouched', () => {
    const h = harness();
    for (const e of [h.fire('keydown', true), h.fire('click', true, radio), h.fire('change', true, radio)])
      expect([e.stopped, e.prevented]).toEqual([false, false]);
    expect(h.reports).toEqual([]);
  });

  it('a scripted key or answer is stopped, and the first is one automated_input report', () => {
    const h = harness();
    const key = h.fire('keydown', false);
    expect([key.stopped, key.prevented]).toEqual([true, true]);
    for (const e of [h.fire('click', false, radio), h.fire('click', false, optionText), h.fire('change', false, radio)])
      expect(e.stopped).toBe(true);
    expect(h.reports).toEqual([{ type: 'automated_input', details: { event: 'keydown', kind: 'key' } }]);
  });

  it('a scripted click outside the answer options is left to the page and not reported', () => {
    const h = harness();
    expect(h.fire('click', false, submitButton).stopped).toBe(false);
    expect(h.fire('click', false, null).stopped).toBe(false);
    expect(h.reports).toEqual([]);
  });

  it('removing the guard removes every listener', () => {
    const h = harness();
    expect(h.listeners.size).toBe(9);
    h.remove();
    expect(h.listeners.size).toBe(0);
  });
});
