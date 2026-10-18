import {
  type AttemptEventDetails,
  FACE_CHECK_INTERVAL_MS,
  initialFaceWatch,
  nextFaceWatch,
  type FaceIncident,
} from '@mitaoe/shared';

// The laptop camera during an attempt (spec 7.6, PR-01 to PR-03; docs/testids/phase-3.md "Laptop camera"). The camera
// stays on until the exam screen closes. Faces are counted on the device every 500 ms from a video element of its own,
// outside the page, so collapsing the self-view never pauses detection; only the incident is reported, never a frame.

/** HTMLMediaElement.HAVE_CURRENT_DATA: the video has a frame to analyse. */
const HAVE_CURRENT_DATA = 2;

/** Counts the faces in the video's current frame. */
export type FaceCounter = (video: HTMLVideoElement) => number;

export interface CameraWatchDeps {
  openCamera: () => Promise<MediaStream>;
  /** The shared on-device detector (one per session, PERF-05). */
  loadCounter: () => Promise<FaceCounter>;
  createVideo: () => HTMLVideoElement;
  now: () => number;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every: (fn: () => void, ms: number) => () => void;
  report: (type: FaceIncident, details: AttemptEventDetails) => void;
  /** The live camera stream for the self-view, or null once it is stopped. */
  onStream: (stream: MediaStream | null) => void;
}

/** Starts the camera and face detection; returns the function that turns both off (leaving the exam screen). */
export function startCameraWatch(deps: CameraWatchDeps): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let cameraFailed = false;
  let counter: FaceCounter | null = null;
  let state = initialFaceWatch;
  const video = deps.createVideo();
  video.muted = true;
  video.playsInline = true;

  void deps.loadCounter().then(
    (c) => void (counter = c),
    // Detection didn't load: preflight required it, so this is rare; no frame can be judged, so nothing is reported.
    () => undefined,
  );
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

  /** Faces in view now, or null when this moment can't be judged (the camera is still starting). */
  const faces = (): number | null => {
    // A camera that failed or was unplugged sees no face (PR-02).
    if (cameraFailed || (stream && stream.getVideoTracks().every((t) => t.readyState === 'ended'))) return 0;
    if (!stream || !counter || video.readyState < HAVE_CURRENT_DATA) return null;
    try {
      return counter(video);
    } catch {
      return null;
    }
  };

  const stopChecks = deps.every(() => {
    const n = faces();
    if (n === null) return;
    const next = nextFaceWatch(state, n, deps.now());
    state = next.state;
    if (next.report) deps.report(next.report.type, { afterMs: next.report.afterMs, faces: n });
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
