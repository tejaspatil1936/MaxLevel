'use client';

import {
  AUDIO_PROOF_MAX_BYTES,
  AUDIO_PROOF_TYPES,
  type AttemptEventDetails,
  type AudioProofType,
  type AudioProofUpload,
} from '@mitaoe/shared';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { startAudioWatch, type MicAnalyser } from './audio-watch';
import { frameOf } from './voice-detector';

/** The recording formats to try, best first: Opus where the browser has it, AAC on Safari. */
const RECORDING_TYPES: Array<[string, AudioProofType]> = [
  ['audio/webm;codecs=opus', 'audio/webm'],
  ['audio/ogg;codecs=opus', 'audio/ogg'],
  ['audio/mp4', 'audio/mp4'],
];

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(text);
}

/** Records `ms` of the stream with MediaRecorder; null where it cannot record audio or the clip is too big. */
async function record(stream: MediaStream, ms: number): Promise<Omit<AudioProofUpload, 'clipId'> | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = RECORDING_TYPES.find(([mime]) => MediaRecorder.isTypeSupported(mime));
  if (!type || !AUDIO_PROOF_TYPES.includes(type[1])) return null;
  const recorder = new MediaRecorder(stream, { mimeType: type[0], audioBitsPerSecond: 24_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (e) => chunks.push(e.data));
  const done = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.start();
  setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), ms);
  await done;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  if (!bytes.length || bytes.length > AUDIO_PROOF_MAX_BYTES) return null;
  return { contentType: type[1], data: base64(bytes) };
}

/** The microphone's spectrum through Web Audio; a suspended context is resumed on the student's next key or click. */
function analyse(stream: MediaStream): MicAnalyser {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createAnalyser();
  node.fftSize = 2_048;
  node.smoothingTimeConstant = 0;
  source.connect(node);
  const spectrum = new Float32Array(node.frequencyBinCount);
  const resume = () => void ctx.resume().catch(() => undefined);
  const gestures = ['pointerdown', 'keydown'] as const;
  for (const g of gestures) document.addEventListener(g, resume, { capture: true });
  resume();
  return {
    frame() {
      if (ctx.state !== 'running') return null;
      node.getFloatFrequencyData(spectrum);
      return frameOf(spectrum, ctx.sampleRate, node.fftSize);
    },
    close() {
      for (const g of gestures) document.removeEventListener(g, resume, { capture: true });
      source.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}

/**
 * With the test's voice detection on, the microphone is analysed on the device for as long as the exam screen is
 * open; talking is reported as `voice_detected` with a short proof clip, and a microphone that is refused or stops as
 * `mic_unavailable` (both logged for review, never strikes).
 */
export function useAudioWatch(
  active: boolean,
  attemptId: string,
  report: (type: 'voice_detected' | 'mic_unavailable', details: AttemptEventDetails) => void,
): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !navigator.mediaDevices || typeof AudioContext === 'undefined')
      return;
    return startAudioWatch({
      openMic: () =>
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
          video: false,
        }),
      analyse,
      record,
      upload: (clip) =>
        api(`/v1/attempts/${encodeURIComponent(attemptId)}/audio-proof`, { method: 'POST', body: clip }),
      report,
      every: (fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      now: () => performance.now(),
      newClipId: () => `clip-${crypto.randomUUID().replaceAll('-', '')}`,
    });
  }, [active, attemptId, report]);
}
