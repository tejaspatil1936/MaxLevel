import { describe, expect, it } from 'vitest';
import { DISPLAY_CHECK_MS, isVirtualCamera, startDisplayWatch } from './display-watch';

function harness(initial: boolean | undefined) {
  let extended = initial;
  let changed: () => void = () => undefined;
  let tick: () => void = () => undefined;
  const reports: unknown[] = [];
  const blocked: boolean[] = [];
  const watch = startDisplayWatch({
    isExtended: () => extended,
    onChange: (fn) => {
      changed = fn;
      return () => undefined;
    },
    every: (fn, ms) => {
      expect(ms).toBe(DISPLAY_CHECK_MS);
      tick = fn;
      return () => undefined;
    },
    report: (type, details) => reports.push({ type, details }),
    onBlocked: (b) => blocked.push(b),
  });
  return {
    watch,
    reports,
    blocked,
    set: (v: boolean | undefined) => void (extended = v),
    change: () => changed(),
    tick: () => tick(),
  };
}

describe('startDisplayWatch', () => {
  it('one screen, or a browser that cannot tell, reports and blocks nothing', () => {
    for (const initial of [false, undefined]) {
      const h = harness(initial);
      h.tick();
      expect(h.reports).toEqual([]);
      expect(h.blocked).toEqual([]);
    }
  });

  it('a second screen at the start is one dual_monitor strike and blocks the exam until it is unplugged', () => {
    const h = harness(true);
    expect(h.reports).toEqual([{ type: 'dual_monitor', details: { extended: true } }]);
    expect(h.blocked).toEqual([true]);
    h.tick();
    h.change();
    expect(h.reports, 'one incident').toHaveLength(1);
    h.set(false);
    h.watch.check();
    expect(h.blocked).toEqual([true, false]);
  });

  it('a screen plugged in during the exam is caught by the change event or the next look, and again after an unplug', () => {
    const h = harness(false);
    h.set(true);
    h.change();
    expect(h.reports).toHaveLength(1);
    h.set(false);
    h.tick();
    h.set(true);
    h.tick();
    expect(h.reports).toHaveLength(2);
    expect(h.blocked).toEqual([true, false, true]);
  });

  it('stops looking once stopped', () => {
    const h = harness(false);
    h.watch.stop();
    h.set(true);
    h.change();
    h.tick();
    expect(h.reports).toEqual([]);
  });
});

describe('isVirtualCamera', () => {
  it('names the software cameras that can feed any video', () => {
    for (const label of [
      'OBS Virtual Camera',
      'OBS-Camera',
      'ManyCam Virtual Webcam',
      'XSplit VCam',
      'Snap Camera',
      'mmhmm',
      'SplitCam Video Driver',
      'e2eSoft VCam',
      'Virtual Camera',
    ])
      expect(isVirtualCamera(label), label).toBe(true);
  });

  it('leaves real cameras, fake test devices and an unknown label alone', () => {
    for (const label of [
      'Integrated Webcam (0bda:5520)',
      'FaceTime HD Camera',
      'HP TrueVision HD Camera',
      'Logitech HD Webcam C270',
      'fake_device_0',
      'Jobs camera',
      '',
      null,
      undefined,
    ])
      expect(isVirtualCamera(label), String(label)).toBe(false);
  });
});
