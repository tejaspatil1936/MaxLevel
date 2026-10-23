// Talking near the laptop, judged on the device from the microphone's spectrum, 10 times a second. No model and no
// network: each frame gives the level of the voice band (85 Hz to 3.5 kHz), of the whisper band (2 to 5 kHz) and how
// tonal the voice band is. A frame counts as voice when it stands well above the room's own noise floor and is not a
// pure tone (the fake test microphone's beep, a fan's whine, a phone ringtone). Talking is reported when such frames
// fill most of the last 2.5 seconds and their level moves the way syllables do: a click, a pen drop or a steady noise
// (a fan, traffic) never qualifies. The thresholds lean towards missing quiet speech rather than flagging silence, and
// every report is logged for a person to review with its clip, never a strike.

/** How often a frame is taken. */
export const VOICE_FRAME_MS = 100;
/** Talking must fill most of this window to be reported (the plan's 2.5 seconds). */
export const VOICE_WINDOW_MS = 2_500;
/** After a report, the same talk is not reported again until it stops; a new report needs this long after the last. */
export const VOICE_COOLDOWN_MS = 60_000;

const WINDOW = VOICE_WINDOW_MS / VOICE_FRAME_MS;
/** A voice frame stands this far above the noise floor (dB), and a whisper frame this far in its own band. */
const VOICE_SNR_DB = 12;
const WHISPER_SNR_DB = 10;
/** Quieter than this (dBFS) is never voice, whatever the floor: digital silence and a muted microphone. */
const MIN_LEVEL_DB = -65;
/** A frame whose two strongest bins hold more than this share of the band's energy is a tone, not a voice. */
const MAX_TONALITY = 0.5;
/** Share of the window that must be voice, and the level swing (dB) syllables give. */
const MIN_ACTIVE_SHARE = 0.6;
const MIN_SWING_DB = 4;
/** The floor follows a quieter room at once and a louder one slowly (dB per frame). */
const FLOOR_RISE_DB = 0.05;
const FLOOR_LOWEST_DB = -100;

export interface VoiceFrame {
  /** Voice band level, dBFS. */
  level: number;
  /** Whisper band level, dBFS. */
  hiLevel: number;
  /** Share of the voice band's energy in its two strongest bins, 0 to 1. */
  tonality: number;
}

/** The frame of one spectrum: `spectrumDb` as AnalyserNode.getFloatFrequencyData gives it. */
export function frameOf(spectrumDb: Float32Array, sampleRate: number, fftSize: number): VoiceFrame {
  const hz = sampleRate / fftSize;
  const band = (from: number, to: number) => {
    let sum = 0;
    let top1 = 0;
    let top2 = 0;
    const end = Math.min(spectrumDb.length - 1, Math.floor(to / hz));
    for (let k = Math.max(1, Math.ceil(from / hz)); k <= end; k++) {
      const v = spectrumDb[k] ?? -Infinity;
      const p = Number.isFinite(v) ? 10 ** (v / 10) : 0;
      sum += p;
      if (p > top1) [top1, top2] = [p, top1];
      else if (p > top2) top2 = p;
    }
    return { db: sum > 0 ? 10 * Math.log10(sum) : FLOOR_LOWEST_DB * 2, peak: sum > 0 ? (top1 + top2) / sum : 0 };
  };
  const voice = band(85, 3_500);
  const hi = band(2_000, 5_000);
  return { level: voice.db, hiLevel: hi.db, tonality: voice.peak };
}

export interface VoiceWatchState {
  floor: number;
  hiFloor: number;
  /** The last WINDOW frames: voice (v), whisper (w) or neither (-), with how far (dB) it stood above its floor. */
  recent: Array<{ kind: 'v' | 'w' | '-'; snr: number }>;
  /** Talk already reported and still going on. */
  talking: boolean;
  lastReportAt: number | null;
}

export const initialVoiceWatch: VoiceWatchState = {
  floor: 0,
  hiFloor: 0,
  recent: [],
  talking: false,
  lastReportAt: null,
};

export interface VoiceReport {
  durationMs: number;
  /** 0 to 1: how far above the floor and how much of the window. */
  confidence: number;
  /** Most of the talk had no voiced energy: whispering. */
  whisper: boolean;
}

const follow = (floor: number, level: number, first: boolean) =>
  first || level < floor ? Math.max(level, FLOOR_LOWEST_DB) : floor + FLOOR_RISE_DB;

/** One frame at `now`; `report` when talking is first judged to be going on. */
export function nextVoiceWatch(
  state: VoiceWatchState,
  frame: VoiceFrame,
  now: number,
): { state: VoiceWatchState; report?: VoiceReport } {
  const first = state.recent.length === 0;
  const floor = follow(state.floor, frame.level, first);
  const hiFloor = follow(state.hiFloor, frame.hiLevel, first);
  const tonal = frame.tonality > MAX_TONALITY;
  const voiced = !tonal && frame.level >= MIN_LEVEL_DB && frame.level - state.floor >= VOICE_SNR_DB && !first;
  const whispered =
    !voiced && !tonal && !first && frame.hiLevel >= MIN_LEVEL_DB && frame.hiLevel - state.hiFloor >= WHISPER_SNR_DB;
  const kind = voiced ? 'v' : whispered ? 'w' : '-';
  const snr = whispered ? frame.hiLevel - state.hiFloor : frame.level - state.floor;
  const recent = [...state.recent, { kind, snr } as const].slice(-WINDOW);
  const active = recent.filter((f) => f.kind !== '-');
  const share = recent.length < WINDOW ? 0 : active.length / WINDOW;
  const snrs = active.map((f) => f.snr);
  const swing = snrs.length ? Math.max(...snrs) - Math.min(...snrs) : 0;
  // The talk spans the whole window: voice near its start and near its end, so it has gone on for 2.5 seconds.
  const spans = recent.slice(0, 2).some((f) => f.kind !== '-') && recent.slice(-4).some((f) => f.kind !== '-');
  const talkNow = share >= MIN_ACTIVE_SHARE && swing >= MIN_SWING_DB && spans;
  // Talk already reported goes on until less than a third of the window is voice.
  const talking = state.talking ? share >= MIN_ACTIVE_SHARE / 2 : talkNow;
  const next: VoiceWatchState = { floor, hiFloor, recent, talking, lastReportAt: state.lastReportAt };
  const due = state.lastReportAt === null || now - state.lastReportAt >= VOICE_COOLDOWN_MS;
  if (!talkNow || state.talking || !due) return { state: next };
  const meanSnr = snrs.reduce((sum, v) => sum + v, 0) / snrs.length;
  const strength = Math.max(0, Math.min(1, (meanSnr - WHISPER_SNR_DB) / 20));
  const confidence = Math.round(Math.min(1, 0.5 * share + 0.5 * strength) * 100) / 100;
  const whisper = active.filter((f) => f.kind === 'w').length > active.length / 2;
  return {
    state: { ...next, lastReportAt: now },
    report: { durationMs: active.length * VOICE_FRAME_MS, confidence, whisper },
  };
}
