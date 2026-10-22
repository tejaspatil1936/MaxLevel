import {
  type AttemptEventDetails,
  type CameraIncident,
  FACE_CHECK_INTERVAL_MS,
  initialFaceWatch,
  nextFaceWatch,
  nextPhoneSight,
  PHONE_CHECK_INTERVAL_MS,
  type PhoneSightState,
} from '@mitaoe/shared';

// The laptop camera during an attempt (spec 7.6, PR-01 to PR-03; docs/testids/phase-3.md "Laptop camera"). The camera
// stays on until the exam screen closes. Faces are counted on the device every 500 ms and phones every second, from a
// video element of its own, outside the page, so collapsing the self-view never pauses detection; only the incident is
// reported, never a frame.

/** HTMLMediaElement.HAVE_CURRENT_DATA: the video has a frame to analyse. */
const HAVE_CURRENT_DATA = 2;
/** A detector that failed to load is tried again after this long, so a passing network error never ends proctoring. */
export const DETECTOR_RETRY_MS = 10_000;

/** Counts the faces (or phones) in the video's current frame. */
export type FaceCounter = (video: HTMLVideoElement) => number;

export interface CameraWatchDeps {
  openCamera: () => Promise<MediaStream>;
  /** The shared on-device face detector (one per session, PERF-05). */
  loadCounter: () => Promise<FaceCounter>;
  /** The shared on-device phone detector, loaded in preflight like the face detector. */
  loadPhoneCounter: () => Promise<FaceCounter>;
  createVideo: () => HTMLVideoElement;
  now: () => number;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every: (fn: () => void, ms: number) => () => void;
  report: (type: CameraIncident, details: AttemptEventDetails) => void;
  /** The live camera stream for the self-view, or null once it is stopped. */
  onStream: (stream: MediaStream | null) => void;
}

/** Starts the camera and face detection; returns the function that turns both off (leaving the exam screen). */
export function startCameraWatch(deps: CameraWatchDeps): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let cameraFailed = false;
  let state = initialFaceWatch;
  let phoneState: PhoneSightState | null = null;
  let ticks = 0;
  const video = deps.createVideo();
  video.muted = true;
  video.playsInline = true;

  // Until a detector loads no frame can be judged by it, so it reports nothing; a failed load is tried again.
  const faceCounter = detectorSlot(deps.loadCounter, deps.now);
  const phoneCounter = detectorSlot(deps.loadPhoneCounter, deps.now);
  void deps.openCamera().then(
    (s) => {
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      video.srcObject = s;
      void video.play().catch(() => undefined);
      deps.onStream(s);
    },
    () => void (cameraFailed = true),
  );

  /** Faces or phones in view now, or null when this moment can't be judged (the camera is still starting). */
  const count = (counter: FaceCounter | null, ifNoCamera: number | null): number | null => {
    // A camera that failed or was unplugged sees no face (PR-02).
    if (cameraFailed || (stream && stream.getVideoTracks().every((t) => t.readyState === 'ended'))) return ifNoCamera;
    if (!stream || !counter || video.readyState < HAVE_CURRENT_DATA) return null;
    try {
      return counter(video);
    } catch {
      return null;
    }
  };

  const stopChecks = deps.every(() => {
    const now = deps.now();
    const faces = count(faceCounter(), 0);
    if (faces !== null) {
      const next = nextFaceWatch(state, faces, now);
      state = next.state;
      if (next.report) deps.report(next.report.type, { afterMs: next.report.afterMs, faces });
    }
    // The phone detector is the heavier model, so it looks at every other frame the face detector does.
    if (ticks++ % (PHONE_CHECK_INTERVAL_MS / FACE_CHECK_INTERVAL_MS) !== 0) return;
    const phones = count(phoneCounter(), null);
    if (phones !== null) {
      const next = nextPhoneSight(phoneState, phones, now);
      phoneState = next.state;
      if (next.report) deps.report(next.report.type, { afterMs: next.report.afterMs, phones });
    }
  }, FACE_CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    stopChecks();
    for (const track of stream?.getTracks() ?? []) track.stop();
    video.srcObject = null;
    stream = null;
    deps.onStream(null);
  };
}

/** Starts loading a detector; the returned function gives it once loaded, and loads it again a while after a failure. */
function detectorSlot(load: () => Promise<FaceCounter>, now: () => number): () => FaceCounter | null {
  let counter: FaceCounter | null = null;
  let loading = false;
  let retryAt = -Infinity;
  const get = () => {
    if (!counter && !loading && now() >= retryAt) {
      loading = true;
      void load()
        .then(
          (c) => void (counter = c),
          () => void (retryAt = now() + DETECTOR_RETRY_MS),
        )
        .finally(() => void (loading = false));
    }
    return counter;
  };
  get();
  return get;
}
