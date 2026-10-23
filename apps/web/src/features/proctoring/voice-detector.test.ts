import { describe, expect, it } from 'vitest';
import {
  frameOf,
  initialVoiceWatch,
  nextVoiceWatch,
  VOICE_COOLDOWN_MS,
  VOICE_FRAME_MS,
  type VoiceFrame,
  type VoiceReport,
  type VoiceWatchState,
} from './voice-detector';

/** Runs frames through the watch, one every 100 ms; returns the reports with their times. */
function run(frames: VoiceFrame[], start: VoiceWatchState = initialVoiceWatch) {
  let state = start;
  const reports: Array<VoiceReport & { at: number }> = [];
  frames.forEach((frame, i) => {
    const at = i * VOICE_FRAME_MS;
    const next = nextVoiceWatch(state, frame, at);
    state = next.state;
    if (next.report) reports.push({ ...next.report, at });
  });
  return { reports, state };
}

const room = (n: number, level = -70): VoiceFrame[] =>
  Array.from({ length: n }, (_, i) => ({ level: level + (i % 3) * 0.5, hiLevel: level - 5, tonality: 0.1 }));
/** Speech: syllables of 200 to 300 ms well above the room, short gaps, the level moving by 10 dB or more. */
const talk = (n: number, base = -40): VoiceFrame[] =>
  Array.from({ length: n }, (_, i) => {
    const gap = i % 4 === 3;
    return gap
      ? { level: -68, hiLevel: -76, tonality: 0.1 }
      : { level: base + ((i * 7) % 12), hiLevel: base - 10, tonality: 0.15 };
  });
const whisper = (n: number): VoiceFrame[] =>
  Array.from({ length: n }, (_, i) =>
    i % 4 === 3
      ? { level: -69, hiLevel: -76, tonality: 0.1 }
      : { level: -66, hiLevel: -55 + ((i * 5) % 8), tonality: 0.2 },
  );

describe('nextVoiceWatch', () => {
  it('a quiet room, however long, is never talking', () => {
    expect(run(room(600)).reports).toEqual([]);
  });

  it('talking for 2.5 seconds is one report, with its duration and confidence', () => {
    const { reports } = run([...room(30), ...talk(60)]);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.at).toBeGreaterThanOrEqual(30 * VOICE_FRAME_MS + 2_300);
    expect(reports[0]!.at).toBeLessThanOrEqual(30 * VOICE_FRAME_MS + 3_500);
    expect(reports[0]!.whisper).toBe(false);
    expect(reports[0]!.confidence).toBeGreaterThan(0.5);
    expect(reports[0]!.durationMs).toBeGreaterThanOrEqual(1_500);
  });

  it('a short remark, a cough or a click is not talking', () => {
    expect(run([...room(30), ...talk(12), ...room(60)]).reports).toEqual([]);
    const clicks = Array.from({ length: 300 }, (_, i) =>
      i % 10 === 0 ? { level: -30, hiLevel: -30, tonality: 0.2 } : room(1)[0]!,
    );
    expect(run([...room(30), ...clicks]).reports).toEqual([]);
  });

  it('a steady noise that starts suddenly (a fan, a vacuum cleaner) is not talking', () => {
    const fan = Array.from({ length: 600 }, () => ({ level: -35, hiLevel: -40, tonality: 0.05 }));
    expect(run([...room(30), ...fan]).reports).toEqual([]);
  });

  it('a pure tone (the fake test microphone beep, a ringtone, a whine) is not talking', () => {
    const beep = Array.from({ length: 600 }, (_, i) => ({ level: i % 2 ? -10 : -40, hiLevel: -90, tonality: 0.95 }));
    expect(run([...room(30), ...beep]).reports).toEqual([]);
    // Chromium's fake microphone: digital silence with a 100 ms beep every 500 ms.
    const fake = Array.from({ length: 600 }, (_, i) =>
      i % 5 === 0 ? { level: -7, hiLevel: -120, tonality: 0.9 } : { level: -200, hiLevel: -200, tonality: 0 },
    );
    expect(run(fake).reports).toEqual([]);
  });

  it('whispering is reported as a whisper', () => {
    const { reports } = run([...room(30), ...whisper(60)]);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.whisper).toBe(true);
  });

  it('talk that goes on is one report; after it stops, new talk waits for the cooldown', () => {
    const { reports } = run([...room(30), ...talk(300)]);
    expect(reports).toHaveLength(1);
    const again = run([...room(30), ...talk(60), ...room(100), ...talk(60)]).reports;
    expect(again, 'within the cooldown').toHaveLength(1);
    const later = run([...room(30), ...talk(60), ...room(VOICE_COOLDOWN_MS / VOICE_FRAME_MS), ...talk(60)]).reports;
    expect(later).toHaveLength(2);
  });

  it('starting in the middle of talk still finds it once the speaker pauses', () => {
    expect(run([...talk(5), ...talk(100)]).reports.length).toBe(1);
  });
});

describe('frameOf', () => {
  const sampleRate = 48_000;
  const fftSize = 2_048;
  const bin = (hz: number) => Math.round(hz / (sampleRate / fftSize));
  const spectrum = (fill: number, peaks: Record<number, number> = {}) => {
    const s = new Float32Array(fftSize / 2).fill(fill);
    for (const [hz, db] of Object.entries(peaks)) s[bin(Number(hz))] = db;
    return s;
  };

  it('a pure tone is tonal; broadband sound is not', () => {
    expect(frameOf(spectrum(-120, { 400: -10 }), sampleRate, fftSize).tonality).toBeGreaterThan(0.9);
    expect(frameOf(spectrum(-60), sampleRate, fftSize).tonality).toBeLessThan(0.05);
  });

  it('the voice band and the whisper band are measured apart', () => {
    const low = frameOf(spectrum(-120, { 300: -20, 600: -22, 900: -25 }), sampleRate, fftSize);
    expect(low.level).toBeGreaterThan(-20);
    expect(low.hiLevel).toBeLessThan(-90);
    const high = frameOf(spectrum(-120, { 3_000: -30, 4_000: -30 }), sampleRate, fftSize);
    expect(high.hiLevel).toBeGreaterThan(-30);
  });

  it('digital silence (-Infinity bins) is very quiet, not an error', () => {
    const f = frameOf(new Float32Array(fftSize / 2).fill(-Infinity), sampleRate, fftSize);
    expect(f.level).toBeLessThan(-150);
    expect(f.tonality).toBe(0);
  });
});
