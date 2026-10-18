import type { FaceDetector } from '@mediapipe/tasks-vision';

// MediaPipe FaceDetector (BlazeFace short range) from the web app's own origin (PR-01). Preflight loads it once and the
// exam screen reuses the same instance: the exam is one client-side session, so nothing is fetched again (PERF-05).

/** Where apps/web/scripts/copy-mediapipe.mjs puts the WASM files and where the model is committed. */
export const MEDIAPIPE_WASM = '/mediapipe/wasm';
export const FACE_MODEL = '/mediapipe/models/blaze_face_short_range.tflite';

let loading: Promise<FaceDetector> | null = null;

/**
 * The shared detector, in video mode on the CPU (the GPU delegate is missing or slow on many college laptops, and
 * BlazeFace short range is light enough). A failed load is forgotten, so `Check again` tries afresh.
 */
export function loadFaceDetector(): Promise<FaceDetector> {
  loading ??= (async () => {
    // Imported here, not at the top, so MediaPipe's JavaScript stays out of every other page's bundle.
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
      runningMode: 'VIDEO',
    });
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

let lastTimestamp = 0;

/** Faces in the video's current frame. Video mode needs rising timestamps, so equal readings are nudged forward. */
export function countFaces(detector: FaceDetector, video: HTMLVideoElement): number {
  lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
  return detector.detectForVideo(video, lastTimestamp).detections.length;
}
