import type { PhoneCamera } from '@mitaoe/shared';

// The phone's camera during an attempt (PR-15). Phones stop the camera when the screen locks, the browser goes to the
// background or a call comes in: the track is muted (often for good on iOS) or ended. The keeper reopens it rather
// than waiting, and says at every change whether it is live, so the presence record and the laptop know (PR-16).

/** A muted track that has not come back after this long is reopened. */
export const MUTED_REOPEN_MS = 3_000;
/** A camera that failed to open is tried again this often while the page is shown. */
export const REOPEN_RETRY_MS = 5_000;

export interface CameraDeps {
  open: () => Promise<MediaStream>;
  visible: () => boolean;
  /** Calls `fn` whenever the page is shown again; returns a function that stops it. */
  onShown: (fn: () => void) => () => void;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
}

export interface CameraEvents {
  state: (camera: PhoneCamera) => void;
  stream: (stream: MediaStream | null) => void;
}

/** Opens the camera and keeps it open; returns the function that stops it for good. */
export function keepCamera(deps: CameraDeps, on: CameraEvents): () => void {
  let stopped = false;
  let opening = false;
  let stream: MediaStream | null = null;
  let detach: () => void = () => undefined;
  let cancelTimer: () => void = () => undefined;
  let current: PhoneCamera | null = null;

  const set = (camera: PhoneCamera) => {
    if (camera === current) return;
    current = camera;
    on.state(camera);
  };
  const later = (fn: () => void, ms: number) => {
    cancelTimer();
    cancelTimer = deps.schedule(fn, ms);
  };
  const track = () => stream?.getVideoTracks()[0] ?? null;
  const healthy = () => {
    const t = track();
    return !!t && t.readyState === 'live' && !t.muted;
  };

  const release = () => {
    detach();
    detach = () => undefined;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const attach = (s: MediaStream) => {
    stream = s;
    const t = track();
    if (!t) return;
    const muted = () => {
      set('paused');
      later(() => void (t.muted ? reopen() : undefined), MUTED_REOPEN_MS);
    };
    const unmuted = () => {
      cancelTimer();
      set('live');
    };
    const ended = () => {
      set('paused');
      void reopen();
    };
    t.addEventListener('mute', muted);
    t.addEventListener('unmute', unmuted);
    t.addEventListener('ended', ended);
    detach = () => {
      t.removeEventListener('mute', muted);
      t.removeEventListener('unmute', unmuted);
      t.removeEventListener('ended', ended);
    };
    on.stream(s);
    if (t.muted) muted();
    else set('live');
  };

  /** Opens the camera afresh: one attempt at a time, retried while it fails and the page is shown. */
  async function reopen(): Promise<void> {
    if (stopped || opening) return;
    opening = true;
    cancelTimer();
    release();
    on.stream(null);
    try {
      const s = await deps.open();
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      attach(s);
    } catch {
      if (stopped) return;
      set(current === null || current === 'starting' || current === 'failed' ? 'failed' : 'paused');
      later(() => void (deps.visible() ? reopen() : undefined), REOPEN_RETRY_MS);
    } finally {
      opening = false;
    }
  }

  set('starting');
  void reopen();
  const offShown = deps.onShown(() => {
    if (!healthy()) void reopen();
  });
  return () => {
    stopped = true;
    offShown();
    cancelTimer();
    release();
    on.stream(null);
  };
}
