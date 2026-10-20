import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserSupported,
  checksFor,
  checksPassed,
  clockCheck,
  rememberChecksPassed,
  startBlock,
} from './device-checks';

const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  headless:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.7339.16 Safari/537.36',
  oldChrome: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  oldFirefox: 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0',
  safari17:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  safari16:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
};

describe('preflight checks', () => {
  it('EX-01 lists screen, fullscreen and camera checks only as the test needs them, then connection, clock and browser', () => {
    expect(checksFor({ fullscreenRequired: false, cameraRequired: false })).toEqual([
      'screen',
      'connection',
      'clock',
      'browser',
    ]);
    expect(checksFor({ fullscreenRequired: true, cameraRequired: true })).toEqual([
      'screen',
      'fullscreen',
      'camera',
      'face',
      'connection',
      'clock',
      'browser',
    ]);
    expect(checksFor({ fullscreenRequired: false, cameraRequired: true })).toEqual([
      'screen',
      'camera',
      'face',
      'connection',
      'clock',
      'browser',
    ]);
  });

  it('EX-01 passes current Chrome, Edge and Firefox and Safari 17 or later, and nothing older or WebKit on iOS', () => {
    for (const ua of [UA.chrome, UA.headless, UA.edge, UA.firefox, UA.safari17])
      expect(browserSupported(ua), ua).toBe(true);
    for (const ua of [UA.oldChrome, UA.oldFirefox, UA.safari16, UA.chromeIos, ''])
      expect(browserSupported(ua), ua).toBe(false);
  });

  it('EX-01 the clock passes within 5 minutes of the server and reports whole seconds either way', () => {
    expect(clockCheck(0)).toEqual({ passed: true, seconds: 0 });
    expect(clockCheck(-1_600)).toEqual({ passed: true, seconds: 2 });
    expect(clockCheck(300_000)).toEqual({ passed: true, seconds: 300 });
    expect(clockCheck(-300_001)).toEqual({ passed: false, seconds: 300 });
  });
});

describe('rules screen start', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('EX-02 Start waits for the checks, then the agreement, then the phone with a second camera', () => {
    const ready = { checksPassed: true, agreed: true, secondCamera: false, phoneConnected: false };
    expect(startBlock(ready)).toBeNull();
    expect(startBlock({ ...ready, checksPassed: false, agreed: false })).toBe('checks');
    expect(startBlock({ ...ready, agreed: false, secondCamera: true })).toBe('agreement');
    expect(startBlock({ ...ready, secondCamera: true })).toBe('phone');
    expect(startBlock({ ...ready, secondCamera: true, phoneConnected: true })).toBeNull();
  });

  it('EX-02 passed checks are kept per test for the browser session, and blocked storage counts as not passed', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    expect(checksPassed('t1')).toBe(false);
    rememberChecksPassed('t1', true);
    expect(checksPassed('t1')).toBe(true);
    expect(checksPassed('t2')).toBe(false);
    rememberChecksPassed('t1', false);
    expect(checksPassed('t1')).toBe(false);

    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => rememberChecksPassed('t1', true)).not.toThrow();
    expect(checksPassed('t1')).toBe(false);
  });
});
