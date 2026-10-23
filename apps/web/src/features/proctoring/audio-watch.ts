import { AUDIO_PROOF_CLIP_MS, type AudioProofUpload } from '@mitaoe/shared';
import { initialVoiceWatch, nextVoiceWatch, VOICE_FRAME_MS, type VoiceFrame } from './voice-detector';

// Voice detection during an attempt (owner request 2026-10-23). The microphone is analysed on the device by
// `nextVoiceWatch`; nothing leaves the device until talking is detected. Then one `voice_detected` event is reported
// (logged for review, never a strike) and the next few seconds are recorded and uploaded as its proof clip. A
// microphone that cannot be opened, or stops, is reported once as `mic_unavailable` and tried again.

/** A microphone that failed or stopped is tried again this often. */
export const MIC_RETRY_MS = 30_000;
/** A clip upload that failed is tried again after 2, 4 then 8 seconds. */
const UPLOAD_RETRIES_MS = [2_000, 4_000, 8_000];

export interface MicAnalyser {
  /** The current frame, or null while the audio pipeline is not running (a suspended audio context). */
  frame(): VoiceFrame | null;
  close(): void;
}

export interface AudioWatchDeps {
  openMic: () => Promise<MediaStream>;
  analyse: (stream: MediaStream) => MicAnalyser;
  /** Records `ms` of the stream; null where the browser cannot record audio. */
  record: (stream: MediaStream, ms: number) => Promise<Omit<AudioProofUpload, 'clipId'> | null>;
  upload: (clip: AudioProofUpload) => Promise<unknown>;
  report: (
    type: 'voice_detected' | 'mic_unavailable',
    details: Record<string, string | number | boolean | null>,
  ) => void;
  every: (fn: () => void, ms: number) => () => void;
  schedule: (fn: () => void, ms: number) => () => void;
  now: () => number;
  newClipId: () => string;
}

/** Starts listening; returns the function that stops it and turns the microphone off. */
export function startAudioWatch(deps: AudioWatchDeps): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let analyser: MicAnalyser | null = null;
  let state = initialVoiceWatch;
  let recording = false;
  let unavailableReported = false;
  const timers = new Set<() => void>();
  const later = (fn: () => void, ms: number) => {
    const cancel = deps.schedule(() => {
      timers.delete(cancel);
      fn();
    }, ms);
    timers.add(cancel);
  };

  const unavailable = (reason: string) => {
    if (!unavailableReported) {
      unavailableReported = true;
      deps.report('mic_unavailable', { reason });
    }
    later(() => void open(), MIC_RETRY_MS);
  };

  const release = () => {
    analyser?.close();
    analyser = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  async function open(): Promise<void> {
    if (stopped || stream) return;
    try {
      const s = await deps.openMic();
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      analyser = deps.analyse(s);
      state = initialVoiceWatch;
      s.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (stream !== s) return;
        release();
        unavailable('ended');
      });
    } catch (e) {
      unavailable((e as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }

  const upload = (clip: AudioProofUpload, attempt = 0) =>
    void deps.upload(clip).catch(() => {
      const wait = UPLOAD_RETRIES_MS[attempt];
      if (wait !== undefined && !stopped) later(() => upload(clip, attempt + 1), wait);
    });

  const proof = (s: MediaStream, clipId: string) => {
    recording = true;
    void deps
      .record(s, AUDIO_PROOF_CLIP_MS)
      .then((clip) => {
        if (clip && !stopped) upload({ clipId, ...clip });
      })
      .catch(() => undefined)
      .finally(() => void (recording = false));
  };

  const stopTicks = deps.every(() => {
    const frame = analyser?.frame();
    if (!frame || !stream) return;
    const next = nextVoiceWatch(state, frame, deps.now());
    state = next.state;
    if (!next.report) return;
    // One clip at a time: talk reported while a clip is still recording keeps its event, without a clip.
    const clipId = recording ? null : deps.newClipId();
    deps.report('voice_detected', { ...next.report, clipId });
    if (clipId) proof(stream, clipId);
  }, VOICE_FRAME_MS);

  void open();
  return () => {
    stopped = true;
    stopTicks();
    for (const cancel of timers) cancel();
    timers.clear();
    release();
  };
}
