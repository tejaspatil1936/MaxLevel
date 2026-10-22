import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';

// MediaPipe FaceDetector (BlazeFace short range) and ObjectDetector (EfficientDet-Lite2, for phones) from the web app's
// own origin (PR-01). Preflight loads both once and the exam screen reuses the same instances: the exam is one
// client-side session, so nothing is fetched again (PERF-05).

/** Where apps/web/scripts/copy-mediapipe.mjs puts the WASM files and where the models are committed. */
export const MEDIAPIPE_WASM = '/mediapipe/wasm';
export const FACE_MODEL = '/mediapipe/models/blaze_face_short_range.tflite';
export const PHONE_MODEL = '/mediapipe/models/efficientdet_lite2.tflite';
/** The COCO label EfficientDet gives a phone, and the score a detection needs to count as one. */
const PHONE_LABEL = 'cell phone';
const PHONE_MIN_SCORE = 0.4;

/** Loads once and remembers the result; a failed load is forgotten, so `Check again` and the exam screen try afresh. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    loading ??= load().catch((e: unknown) => {
      loading = null;
      throw e;
    });
    return loading;
  };
}

// Imported here, not at the top, so MediaPipe's JavaScript stays out of every other page's bundle.
const vision = () => import('@mediapipe/tasks-vision');

/**
 * The shared face detector, in video mode on the CPU (the GPU delegate is missing or slow on many college laptops, and
 * BlazeFace short range is light enough).
 */
export const loadFaceDetector = once(async (): Promise<FaceDetector> => {
  const { FaceDetector, FilesetResolver } = await vision();
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
  });
});

/**
 * The shared phone detector: EfficientDet-Lite2 (int8) on the CPU, keeping only `cell phone` detections. Lite0 scored
 * clear phone photos as low as 0.30; Lite2 scored them 0.54 or more and other objects 0.13 at most.
 */
export const loadPhoneDetector = once(async (): Promise<ObjectDetector> => {
  const { ObjectDetector, FilesetResolver } = await vision();
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: PHONE_MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    categoryAllowlist: [PHONE_LABEL],
    scoreThreshold: PHONE_MIN_SCORE,
  });
});

/** Video mode needs rising timestamps per detector, so equal readings are nudged forward. */
function timestamps(): () => number {
  let last = 0;
  return () => (last = Math.max(performance.now(), last + 1));
}
const faceTime = timestamps();
const phoneTime = timestamps();

/** Faces in the video's current frame. */
export function countFaces(detector: FaceDetector, video: HTMLVideoElement): number {
  return detector.detectForVideo(video, faceTime()).detections.length;
}

/** Phones in the video's current frame. */
export function countPhones(detector: ObjectDetector, video: HTMLVideoElement): number {
  return detector.detectForVideo(video, phoneTime()).detections.length;
}
