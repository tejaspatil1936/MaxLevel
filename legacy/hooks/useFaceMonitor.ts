"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FilesetResolver, FaceDetector, ObjectDetector } from "@mediapipe/tasks-vision";

export interface FaceMonitorOptions {
  isActive: boolean;
  onViolation?: (
    type: "camera_no_face" | "camera_multiple_faces" | "camera_lost" | "camera_phone_detected",
    message: string
  ) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useFaceMonitor({
  isActive,
  onViolation,
  videoRef,
}: FaceMonitorOptions) {
  const [detectorReady, setDetectorReady] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [faceCount, setFaceCount] = useState<number>(1);
  const [monitorStatus, setMonitorStatus] = useState<
    "initializing" | "ready" | "no_face" | "multiple_faces" | "camera_lost" | "phone_detected" | "error"
  >("initializing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const selectedDeviceIdRef = useRef<string | null>(null);
  selectedDeviceIdRef.current = selectedDeviceId;

  const detectorRef = useRef<FaceDetector | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep onViolation in a stable ref to prevent loop tear-down on parent re-renders
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  // Condition tracking for sustained violation and re-arm
  const noFaceStart = useRef<number | null>(null);
  const multipleFacesStart = useRef<number | null>(null);
  const cameraLostStart = useRef<number | null>(null);

  const noFaceReported = useRef(false);
  const multipleFacesReported = useRef(false);
  const cameraLostReported = useRef(false);

  const lastMultipleFacesReportTime = useRef<number>(0);
  const lastNoFaceReportTime = useRef<number>(0);
  const lastCameraLostReportTime = useRef<number>(0);
  const lastPhoneReportTime = useRef<number>(0);
  const phoneDetectedStart = useRef<number | null>(null);

  const conditionClearedStart = useRef<number | null>(null);

  // Snappy detection interval (750ms default)
  const currentIntervalMs = useRef<number>(750);

  // 1. Initialize MediaPipe FaceDetector & ObjectDetector using self-hosted files under /public
  useEffect(() => {
    let isCancelled = false;

    const initDetector = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("/wasm");
        if (isCancelled) return;

        // Initialize FaceDetector
        let detector: FaceDetector;
        try {
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/models/blaze_face_short_range.tflite",
              delegate: "GPU",
            },
            runningMode: "IMAGE",
            minDetectionConfidence: 0.5,
          });
        } catch {
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/models/blaze_face_short_range.tflite",
              delegate: "CPU",
            },
            runningMode: "IMAGE",
            minDetectionConfidence: 0.5,
          });
        }

        // Initialize ObjectDetector for mobile phone detection
        try {
          const objDetector = await ObjectDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/models/efficientdet_lite0.tflite",
              delegate: "GPU",
            },
            scoreThreshold: 0.30,
            runningMode: "IMAGE",
          });
          objectDetectorRef.current = objDetector;
          console.log("[Proctor] Object detector loaded (GPU)");
        } catch {
          try {
            const objDetector = await ObjectDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "/models/efficientdet_lite0.tflite",
                delegate: "CPU",
              },
              scoreThreshold: 0.30,
              runningMode: "IMAGE",
            });
            objectDetectorRef.current = objDetector;
            console.log("[Proctor] Object detector loaded (CPU)");
          } catch (objErr) {
            console.warn("Object detector init fallback warning:", objErr);
          }
        }

        if (isCancelled) {
          detector.close();
          objectDetectorRef.current?.close();
          return;
        }

        detectorRef.current = detector;
        setDetectorReady(true);
      } catch (err: any) {
        if (!isCancelled) {
          setErrorMessage(err?.message || "Failed to initialize face detector");
          setMonitorStatus("error");
        }
      }
    };

    initDetector();

    return () => {
      isCancelled = true;
      if (detectorRef.current) {
        try {
          detectorRef.current.close();
        } catch {}
      }
      if (objectDetectorRef.current) {
        try {
          objectDetectorRef.current.close();
        } catch {}
      }
    };
  }, []);

  const userManuallySelectedRef = useRef<boolean>(false);

  // Enumerate video devices
  const refreshDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter((d) => d.kind === "videoinput");
      setVideoDevices(videoInputs);
      return videoInputs;
    } catch {
      return [];
    }
  }, []);

  // 2. Request Camera stream with device selection support
  const requestCamera = useCallback(
    async (targetDeviceId?: string): Promise<boolean> => {
      try {
        // Stop existing tracks to cleanly release previous hardware / virtual device
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        // Fetch fresh devices list
        const currentDevices = await refreshDevices();

        // Determine which device ID to attempt
        let deviceIdToUse = targetDeviceId;

        if (!deviceIdToUse && userManuallySelectedRef.current && selectedDeviceIdRef.current) {
          deviceIdToUse = selectedDeviceIdRef.current;
        }

        if (!deviceIdToUse) {
          // Check saved preference from storage if valid
          let savedId: string | null = null;
          try {
            if (typeof window !== "undefined") {
              savedId = window.localStorage.getItem("mitaoe_preferred_camera_id");
            }
          } catch {}

          if (savedId && currentDevices.some((d) => d.deviceId === savedId)) {
            const savedDev = currentDevices.find((d) => d.deviceId === savedId);
            // If saved device is NOT virtual, use it
            if (savedDev && !/obs|virtual|manycam|snap/i.test(savedDev.label || "")) {
              deviceIdToUse = savedId;
            }
          }
        }

        // If still no device specified, prioritize physical webcam over virtual
        if (!deviceIdToUse && currentDevices.length > 0) {
          const physicalDevice = currentDevices.find(
            (d) => d.deviceId && !/obs|virtual|manycam|snap/i.test(d.label || "")
          );
          if (physicalDevice && physicalDevice.deviceId) {
            deviceIdToUse = physicalDevice.deviceId;
          }
        }

        // Base constraints
        let videoConstraints: MediaTrackConstraints;
        if (deviceIdToUse) {
          videoConstraints = {
            deviceId: { exact: deviceIdToUse },
            width: { ideal: 640 },
            height: { ideal: 480 },
          };
        } else {
          videoConstraints = {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
          };
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          });
        } catch (firstErr) {
          // If requesting exact deviceId failed, fallback to any user-facing camera
          if (deviceIdToUse) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false,
            });
          } else {
            throw firstErr;
          }
        }

        streamRef.current = stream;
        setMediaStream(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        // Identify the actual active deviceId from stream settings
        const activeTrack = stream.getVideoTracks()[0];
        const activeSettings = activeTrack?.getSettings();
        const activeDeviceId = activeSettings?.deviceId || deviceIdToUse || null;

        if (activeDeviceId) {
          setSelectedDeviceId(activeDeviceId);
          selectedDeviceIdRef.current = activeDeviceId;
        }

        // Re-enumerate to get unmasked device labels now that permission is granted
        const updatedDevices = await refreshDevices();

        // If the current camera is a virtual camera (like OBS) and wasn't explicitly chosen by user,
        // and another real camera exists, auto-switch to the real physical webcam!
        if (!userManuallySelectedRef.current && activeTrack) {
          const trackLabel = activeTrack.label || "";
          if (/obs|virtual|manycam|snap/i.test(trackLabel)) {
            const alternatePhysicalDevice = updatedDevices.find(
              (d) =>
                d.deviceId &&
                d.deviceId !== activeDeviceId &&
                !/obs|virtual|manycam|snap/i.test(d.label || "")
            );
            if (alternatePhysicalDevice && alternatePhysicalDevice.deviceId) {
              return await requestCamera(alternatePhysicalDevice.deviceId);
            }
          }
        }

        setHasPermission(true);
        setErrorMessage(null);
        return true;
      } catch (err: any) {
        setHasPermission(false);
        setMonitorStatus("camera_lost");
        setErrorMessage(err?.message || "Camera access was denied or no camera device found.");
        return false;
      }
    },
    [videoRef, refreshDevices]
  );

  const switchCamera = useCallback(
    async (deviceId: string): Promise<boolean> => {
      userManuallySelectedRef.current = true;
      setSelectedDeviceId(deviceId);
      selectedDeviceIdRef.current = deviceId;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("mitaoe_preferred_camera_id", deviceId);
        }
      } catch {}
      return await requestCamera(deviceId);
    },
    [requestCamera]
  );

  // Listen for device changes (e.g. plugging/unplugging webcam)
  useEffect(() => {
    refreshDevices();
    const handleDeviceChange = () => {
      refreshDevices();
    };
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

  // 3. Continuous inference loop
  useEffect(() => {
    if (!isActive || !detectorReady || !mediaStream) return;

    let timeoutId: NodeJS.Timeout;
    let isRunning = true;

    const runDetection = () => {
      if (!isRunning) return;

      const video = videoRef.current;
      const detector = detectorRef.current;
      const stream = streamRef.current || mediaStream;

      const tracks = stream?.getVideoTracks() || [];
      const isStreamActive =
        tracks.length > 0 &&
        tracks[0].readyState === "live" &&
        tracks[0].enabled &&
        !tracks[0].muted;

      const now = Date.now();

      // Check stream health
      if (!isStreamActive) {
        if (!cameraLostStart.current) {
          cameraLostStart.current = now;
        } else if (now - cameraLostStart.current >= 5000) {
          if (!cameraLostReported.current || now - lastCameraLostReportTime.current >= 10000) {
            cameraLostReported.current = true;
            lastCameraLostReportTime.current = now;
            onViolationRef.current?.(
              "camera_lost",
              "Camera feed disconnected or muted for more than 5 seconds."
            );
          }
        }
        setMonitorStatus("camera_lost");
        timeoutId = setTimeout(runDetection, currentIntervalMs.current);
        return;
      } else {
        if (cameraLostReported.current) {
          // Re-arm after clearing
          cameraLostReported.current = false;
        }
        cameraLostStart.current = null;
      }

      if (!video || !detector) {
        timeoutId = setTimeout(runDetection, currentIntervalMs.current);
        return;
      }

      // Ensure video is playing
      if (video.paused) {
        video.play().catch(() => {});
      }

      // Check for stalled / blank video frames
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        if (!cameraLostStart.current) {
          cameraLostStart.current = now;
        } else if (now - cameraLostStart.current >= 5000) {
          if (!cameraLostReported.current || now - lastCameraLostReportTime.current >= 10000) {
            cameraLostReported.current = true;
            lastCameraLostReportTime.current = now;
            onViolationRef.current?.(
              "camera_lost",
              "Camera video stream unavailable."
            );
          }
        }
        setMonitorStatus("camera_lost");
        timeoutId = setTimeout(runDetection, currentIntervalMs.current);
        return;
      }

      const inferenceStart = performance.now();
      let detectedFaces = 0;

      try {
        const result = detector.detect(video);
        detectedFaces = result.detections.length;
      } catch (err) {
        // Frame inference failed / dark frame
        console.warn("Face detector frame error:", err);
      }

      const inferenceElapsed = performance.now() - inferenceStart;

      // Adapt interval dynamically
      if (inferenceElapsed > 120) {
        currentIntervalMs.current = Math.min(1500, currentIntervalMs.current + 200);
      } else {
        currentIntervalMs.current = Math.max(700, currentIntervalMs.current - 50);
      }

      setFaceCount(detectedFaces);

      // Check for unauthorized mobile phone in front webcam
      let phoneDetectedInFrame = false;
      let detectedPhoneLabel = "";
      let detectedPhoneConfidence = 0;
      if (objectDetectorRef.current && video) {
        try {
          const objResult = objectDetectorRef.current.detect(video);
          for (const det of objResult.detections || []) {
            for (const cat of det.categories) {
              const name = (cat.categoryName || "").toLowerCase();
              const score = cat.score ?? 0;
              const isPhone =
                name === "cell phone" ||
                name === "mobile phone" ||
                name === "phone" ||
                name === "cellphone" ||
                name === "telephone" ||
                name === "remote" ||
                name === "remote control";

              if (isPhone && score >= 0.35) {
                phoneDetectedInFrame = true;
                detectedPhoneLabel = name;
                detectedPhoneConfidence = score;
                break;
              }
            }
            if (phoneDetectedInFrame) break;
          }
        } catch (objErr) {
          console.warn("Object detector error:", objErr);
        }
      }

      // If mobile phone is detected: immediately alert UI, verify sustained presence for strike
      if (phoneDetectedInFrame) {
        if (!phoneDetectedStart.current) {
          phoneDetectedStart.current = now;
        }

        // Immediately reflect visual warning on webcam thumbnail
        setMonitorStatus("phone_detected");
        conditionClearedStart.current = null;

        const phoneDuration = now - phoneDetectedStart.current;
        if (phoneDuration >= 1200) {
          if (now - lastPhoneReportTime.current >= 12000) {
            lastPhoneReportTime.current = now;
            onViolationRef.current?.(
              "camera_phone_detected",
              `Unauthorized mobile device detected in front webcam (${detectedPhoneLabel || "cell phone"}, ${Math.round(detectedPhoneConfidence * 100)}% match).`
            );
          }
        }

        // Return early so status is not overwritten with "ready" while phone is visible
        timeoutId = setTimeout(runDetection, currentIntervalMs.current);
        return;
      } else {
        phoneDetectedStart.current = null;
      }

      // Evaluate face conditions
      if (detectedFaces === 0) {
        conditionClearedStart.current = null;
        if (!noFaceStart.current) {
          noFaceStart.current = now;
        } else if (now - noFaceStart.current >= 5000) {
          if (!noFaceReported.current || now - lastNoFaceReportTime.current >= 10000) {
            noFaceReported.current = true;
            lastNoFaceReportTime.current = now;
            onViolationRef.current?.(
              "camera_no_face",
              "No face detected in camera frame."
            );
          }
        }
        setMonitorStatus("no_face");
      } else if (detectedFaces > 1) {
        conditionClearedStart.current = null;
        if (!multipleFacesStart.current) {
          multipleFacesStart.current = now;
        } else if (now - multipleFacesStart.current >= 5000) {
          if (!multipleFacesReported.current || now - lastMultipleFacesReportTime.current >= 10000) {
            multipleFacesReported.current = true;
            lastMultipleFacesReportTime.current = now;
            onViolationRef.current?.(
              "camera_multiple_faces",
              "Multiple faces detected in camera feed."
            );
          }
        }
        setMonitorStatus("multiple_faces");
      } else {
        // Exactly 1 face found: normal state
        setMonitorStatus("ready");
        noFaceStart.current = null;
        multipleFacesStart.current = null;

        // Re-arm after condition cleared for 2 seconds
        if (!conditionClearedStart.current) {
          conditionClearedStart.current = now;
        } else if (now - conditionClearedStart.current >= 2000) {
          noFaceReported.current = false;
          multipleFacesReported.current = false;
        }
      }

      timeoutId = setTimeout(runDetection, currentIntervalMs.current);
    };

    // Run first frame immediately (100ms)
    timeoutId = setTimeout(runDetection, 100);

    return () => {
      isRunning = false;
      clearTimeout(timeoutId);
    };
  }, [isActive, detectorReady, mediaStream]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    detectorReady,
    hasPermission,
    faceCount,
    monitorStatus,
    errorMessage,
    requestCamera,
    switchCamera,
    refreshDevices,
    videoDevices,
    selectedDeviceId,
  };
}
