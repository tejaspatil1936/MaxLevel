'use client';

import type { FaceIncident } from '@mitaoe/shared';
import { useEffect, useState } from 'react';
import { startCameraWatch } from './camera-watch';
import { countFaces, loadFaceDetector } from './face-detector';

/**
 * With `cameraRequired`, the camera is on for as long as the exam screen is open and faces are counted on the device
 * (PR-01, PR-02). Preflight stopped its own camera, so this opens it again; the detector is the one preflight loaded.
 * Returns the live stream for the self-view (PR-03).
 */
export function useCameraWatch(
  required: boolean,
  report: (type: FaceIncident, details: Record<string, unknown>) => void,
): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!required) return;
    return startCameraWatch({
      openCamera: () => navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
      loadCounter: async () => {
        const detector = await loadFaceDetector();
        return (video) => countFaces(detector, video);
      },
      createVideo: () => document.createElement('video'),
      // Durations on the monotonic clock, so a re-measured server offset never stretches or shortens the grace.
      now: () => performance.now(),
      every: (fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
      report,
      onStream: setStream,
    });
  }, [required, report]);
  return stream;
}
