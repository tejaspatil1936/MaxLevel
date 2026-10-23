import { describe, expect, it } from 'vitest';
import { MIC_RETRY_MS, startAudioWatch, type AudioWatchDeps } from './audio-watch';
import { VOICE_FRAME_MS, type VoiceFrame } from './voice-detector';

// The microphone glue with a fake stream, analyser, recorder and timers; the detection rules are in
// voice-detector.test.ts.

const quiet: VoiceFrame = { level: -70, hiLevel: -75, tonality: 0.1 };
const speech = (i: number): VoiceFrame =>
  i % 4 === 3
    ? { level: -68, hiLevel: -76, tonality: 0.1 }
    : { level: -40 + ((i * 7) % 12), hiLevel: -50, tonality: 0.15 };

function harness(opts: { mic?: () => boolean; recordable?: boolean; uploads?: () => boolean } = {}) {
  let frame: VoiceFrame = quiet;
  let tick: () => void = () => undefined;
  let timers: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  let opens = 0;
  const tracks: Array<EventTarget & { stopped: boolean; stop(): void }> = [];
  const reports: Array<{ type: string; details: Record<string, unknown> }> = [];
  const uploads: unknown[] = [];
  let ids = 0;
  const deps: AudioWatchDeps = {
    openMic: async () => {
      opens++;
      if (opts.mic && !opts.mic()) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      const track = Object.assign(new EventTarget(), { stopped: false, stop: () => void (track.stopped = true) });
      tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    },
    analyse: () => ({ frame: () => frame, close: () => undefined }),
    record: async () => (opts.recordable === false ? null : { contentType: 'audio/webm', data: 'GkXfow==' }),
    upload: async (clip) => {
      if (opts.uploads && !opts.uploads()) throw new Error('offline');
      uploads.push(clip);
    },
    report: (type, details) => reports.push({ type, details }),
    every: (fn) => {
      tick = fn;
      return () => void (tick = () => undefined);
    },
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => void (timers = timers.filter((x) => x !== timer));
    },
    now: () => now,
    newClipId: () => `clip-0000000${++ids}`,
  };
  const stop = startAudioWatch(deps);
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const frames = async (list: VoiceFrame[]) => {
    for (const f of list) {
      frame = f;
      now += VOICE_FRAME_MS;
      tick();
      const due = timers.filter((x) => x.at <= now);
      timers = timers.filter((x) => x.at > now);
      due.forEach((x) => x.fn());
      await settle();
    }
  };
  return { stop, frames, settle, reports, uploads, tracks, opens: () => opens };
}

const talk = (n: number) => Array.from({ length: n }, (_, i) => speech(i));
const room = (n: number) => Array.from({ length: n }, () => quiet);

describe('startAudioWatch', () => {
  it('a quiet exam reports and uploads nothing', async () => {
    const h = harness();
    await h.settle();
    await h.frames(room(600));
    expect(h.reports).toEqual([]);
    expect(h.uploads).toEqual([]);
  });

  it('talking is one voice_detected event, then its recorded clip is uploaded under the event clip ID', async () => {
    const h = harness();
    await h.settle();
    await h.frames([...room(30), ...talk(60)]);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      type: 'voice_detected',
      details: { clipId: 'clip-00000001', whisper: false },
    });
    expect(h.uploads).toEqual([{ clipId: 'clip-00000001', contentType: 'audio/webm', data: 'GkXfow==' }]);
  });

  it('a browser that cannot record still reports the event, without a clip ID upload', async () => {
    const h = harness({ recordable: false });
    await h.settle();
    await h.frames([...room(30), ...talk(60)]);
    expect(h.reports).toHaveLength(1);
    expect(h.uploads).toEqual([]);
  });

  it('a failed upload is tried again', async () => {
    let tries = 0;
    const h = harness({ uploads: () => ++tries > 2 });
    await h.settle();
    await h.frames([...room(30), ...talk(60), ...room(100)]);
    expect(tries).toBe(3);
    expect(h.uploads).toHaveLength(1);
  });

  it('a refused microphone is one mic_unavailable report, then tried again', async () => {
    let allowed = false;
    const h = harness({ mic: () => allowed });
    await h.settle();
    expect(h.reports).toEqual([{ type: 'mic_unavailable', details: { reason: 'denied' } }]);
    allowed = true;
    await h.frames(room(MIC_RETRY_MS / VOICE_FRAME_MS));
    expect(h.opens()).toBe(2);
    expect(h.reports, 'reported once').toHaveLength(1);
    await h.frames([...room(30), ...talk(60)]);
    expect(h.reports.at(-1)?.type).toBe('voice_detected');
  });

  it('a microphone that stops is reported once and reopened; stopping turns it off', async () => {
    const h = harness();
    await h.settle();
    h.tracks[0]!.dispatchEvent(new Event('ended'));
    expect(h.reports).toEqual([{ type: 'mic_unavailable', details: { reason: 'ended' } }]);
    await h.frames(room(MIC_RETRY_MS / VOICE_FRAME_MS));
    expect(h.tracks).toHaveLength(2);
    h.stop();
    expect(h.tracks[1]!.stopped).toBe(true);
  });
});
