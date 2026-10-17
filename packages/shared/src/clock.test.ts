import { describe, expect, it } from 'vitest';
import { TestClock, type Clock } from './clock';

const fakeReal = (start: number) => {
  let t = start;
  const clock: Clock & { tick(ms: number): void } = { now: () => t, tick: (ms) => (t += ms) };
  return clock;
};

describe('TestClock', () => {
  it('follows real time until set', () => {
    const real = fakeReal(1000);
    const clock = new TestClock(real);
    real.tick(500);
    expect(clock.now()).toBe(1500);
  });

  it('freezes at set and moves with advance', () => {
    const real = fakeReal(1000);
    const clock = new TestClock(real);
    clock.set(50_000);
    real.tick(10_000);
    expect(clock.now()).toBe(50_000);
    clock.advance(2_000);
    expect(clock.now()).toBe(52_000);
  });

  it('resumes real time from the frozen instant', () => {
    const real = fakeReal(1000);
    const clock = new TestClock(real);
    clock.set(9_000);
    clock.followReal();
    real.tick(1_000);
    expect(clock.now()).toBe(10_000);
  });
});
