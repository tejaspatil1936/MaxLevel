import { describe, expect, it } from 'vitest';
import { startCameraWatch, type CameraWatchDeps } from './camera-watch';

// The browser's camera and the detector are handed in, so the loop's timing can be driven here; the real camera and
// MediaPipe run in tests/acceptance/phase-3/F-3.12.spec.ts.

function fakeStream() {
  const track = { readyState: 'live' as MediaStreamTrackState, stop: () => void (track.readyState = 'ended') };
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

async function harness(opts: { camera?: 'ok' | 'fails'; faces?: () => number } = {}) {
  const { track, stream } = fakeStream();
  const video = { readyState: 4, muted: false, playsInline: false, srcObject: null as unknown, play: async () => {} };
  let now = 0;
  let tick: () => void = () => {};
  let ticking = false;
  const reports: Array<{ type: string; details: Record<string, unknown> }> = [];
  const streams: Array<MediaStream | null> = [];
  const deps: CameraWatchDeps = {
    openCamera: () => (opts.camera === 'fails' ? Promise.reject(new Error('NotFoundError')) : Promise.resolve(stream)),
    loadCounter: () => Promise.resolve(() => opts.faces?.() ?? 0),
    createVideo: () => video as unknown as HTMLVideoElement,
    now: () => now,
    every: (fn, ms) => {
      expect(ms).toBe(500);
      tick = fn;
      ticking = true;
      return () => void (ticking = false);
    },
    report: (type, details) => reports.push({ type, details }),
    onStream: (s) => streams.push(s),
  };
  const stop = startCameraWatch(deps);
  await Promise.resolve();
  await Promise.resolve();
  const runFor = (ms: number) => {
    for (let t = 0; t < ms; t += 500) {
      now += 500;
      if (ticking) tick();
    }
  };
  return { stop, runFor, reports, streams, track, video, ticking: () => ticking };
}

describe('startCameraWatch', () => {
  it('PR-02 no face past the 5 s grace reports one no_face however long it lasts', async () => {
    const h = await harness();
    // The first check is 500 ms in; 5 s after it is still within the grace period.
    h.runFor(5500);
    expect(h.reports).toEqual([]);
    h.runFor(500);
    expect(h.reports).toEqual([{ type: 'no_face', details: { afterMs: 5500, faces: 0 } }]);
    h.runFor(60_000);
    expect(h.reports).toHaveLength(1);
  });

  it('PR-02 one face in view reports nothing; two faces past 2 s report multiple_faces', async () => {
    let faces = 1;
    const h = await harness({ faces: () => faces });
    h.runFor(30_000);
    expect(h.reports).toEqual([]);
    faces = 2;
    h.runFor(3000);
    expect(h.reports.map((r) => r.type)).toEqual(['multiple_faces']);
  });

  it('PR-02 a camera that fails during the exam sees no face', async () => {
    const h = await harness({ camera: 'fails' });
    h.runFor(6000);
    expect(h.reports.map((r) => r.type)).toEqual(['no_face']);
  });

  it('PR-03 the camera stream is handed to the self-view and stays live until the exam screen closes', async () => {
    const h = await harness({ faces: () => 1 });
    expect(h.streams).toHaveLength(1);
    expect(h.video.srcObject).toBe(h.streams[0]);
    h.runFor(60_000);
    expect(h.track.readyState).toBe('live');
    h.stop();
    expect(h.track.readyState).toBe('ended');
    expect(h.streams.at(-1)).toBeNull();
    expect(h.ticking()).toBe(false);
  });
});
