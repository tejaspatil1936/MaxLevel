import { describe, expect, it } from 'vitest';
import { keepCamera, MUTED_REOPEN_MS, REOPEN_RETRY_MS, type CameraDeps } from './phone-camera';

// The phone camera keeper with fake tracks and timers (PR-15, PR-16); the real camera runs in
// tests/acceptance/phase-3/F-3.13.spec.ts.

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  muted = false;
  stop() {
    this.readyState = 'ended';
  }
  fire(type: 'mute' | 'unmute' | 'ended') {
    if (type === 'mute') this.muted = true;
    if (type === 'unmute') this.muted = false;
    if (type === 'ended') this.readyState = 'ended';
    this.dispatchEvent(new Event(type));
  }
}

function harness(opts: { fails?: () => boolean } = {}) {
  const tracks: FakeTrack[] = [];
  const states: string[] = [];
  const streams: Array<MediaStream | null> = [];
  let timers: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  let shown: () => void = () => undefined;
  let visible = true;
  const deps: CameraDeps = {
    open: async () => {
      if (opts.fails?.()) throw new Error('NotReadableError');
      const t = new FakeTrack();
      tracks.push(t);
      return { getVideoTracks: () => [t], getTracks: () => [t] } as unknown as MediaStream;
    },
    visible: () => visible,
    onShown: (fn) => {
      shown = fn;
      return () => undefined;
    },
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => void (timers = timers.filter((x) => x !== timer));
    },
  };
  const stop = keepCamera(deps, { state: (s) => states.push(s), stream: (s) => streams.push(s) });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    due.forEach((t) => t.fn());
    await settle();
  };
  return {
    stop,
    states,
    streams,
    tracks,
    settle,
    advance,
    show: async () => {
      shown();
      await settle();
    },
    hide: () => void (visible = false),
  };
}

describe('keepCamera', () => {
  it('PR-15 the camera starts and is live', async () => {
    const h = harness();
    await h.settle();
    expect(h.states).toEqual(['starting', 'live']);
    expect(h.streams.at(-1)).not.toBeNull();
  });

  it('PR-16 a muted camera is paused, and reopened when it does not come back within 3 seconds', async () => {
    const h = harness();
    await h.settle();
    h.tracks[0]!.fire('mute');
    expect(h.states.at(-1)).toBe('paused');
    await h.advance(MUTED_REOPEN_MS - 1);
    expect(h.tracks).toHaveLength(1);
    await h.advance(1);
    expect(h.tracks).toHaveLength(2);
    expect(h.tracks[0]!.readyState, 'the old track is stopped').toBe('ended');
    expect(h.states.at(-1)).toBe('live');
  });

  it('PR-16 a camera unmuted in time is live again without reopening', async () => {
    const h = harness();
    await h.settle();
    h.tracks[0]!.fire('mute');
    h.tracks[0]!.fire('unmute');
    await h.advance(MUTED_REOPEN_MS * 2);
    expect(h.tracks).toHaveLength(1);
    expect(h.states).toEqual(['starting', 'live', 'paused', 'live']);
  });

  it('PR-16 an ended camera is reopened at once, and so is one found dead when the page is shown again', async () => {
    const h = harness();
    await h.settle();
    h.tracks[0]!.fire('ended');
    await h.settle();
    expect(h.tracks).toHaveLength(2);
    h.tracks[1]!.readyState = 'ended';
    await h.show();
    expect(h.tracks).toHaveLength(3);
    expect(h.states.at(-1)).toBe('live');
  });

  it('PR-15 a camera that fails to open is failed, then tried again every 5 seconds while the page is shown', async () => {
    let failing = true;
    const h = harness({ fails: () => failing });
    await h.settle();
    expect(h.states).toEqual(['starting', 'failed']);
    h.hide();
    await h.advance(REOPEN_RETRY_MS);
    expect(h.tracks, 'not while hidden').toHaveLength(0);
    failing = false;
    await h.show();
    expect(h.states.at(-1)).toBe('live');
  });

  it('PR-15 stopping turns the camera off for good', async () => {
    const h = harness();
    await h.settle();
    h.stop();
    expect(h.tracks[0]!.readyState).toBe('ended');
    expect(h.streams.at(-1)).toBeNull();
    await h.show();
    expect(h.tracks).toHaveLength(1);
  });
});
