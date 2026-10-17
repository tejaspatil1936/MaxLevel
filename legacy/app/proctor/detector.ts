"use client";

import { FilesetResolver, FaceDetector, ObjectDetector } from "@mediapipe/tasks-vision";

export interface ProctorEventPayload {
  type: string;
  confidence?: number;
  durationMs?: number;
}

export interface ProctorTelemetry {
  faceCount: number;
  noFaceDurationMs: number;
  cameraBlocked: boolean;
  phoneDetected: boolean;
  bookDetected: boolean;
  avgBrightness: number;
  statusText: string;
  violationState: "normal" | "warning" | "strike";
}

export type ProctorEventCallback = (event: ProctorEventPayload) => void;
export type ProctorTelemetryCallback = (telemetry: ProctorTelemetry) => void;

const CLIENT_COOLDOWNS: Record<string, number> = {
  NO_FACE: 12_000,
  MULTI_FACE: 15_000,
  PHONE_OBJECT: 15_000,
  BOOK_OBJECT: 30_000,
  LOOK_AWAY: 45_000,
  CAMERA_BLOCKED: 15_000,
  DEVICE_MOVED: 30_000,
  PAGE_HIDDEN: 15_000,
  HEARTBEAT_LOST: 45_000,
};

export class ProctorVisionDetector {
  private faceDetector: FaceDetector | null = null;
  private objectDetector: ObjectDetector | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  // Sustained state trackers
  private noFaceSince: number | null = null;
  private multiFaceSince: number | null = null;
  private phoneSince: number | null = null;
  private bookSince: number | null = null;
  private cameraBlockedSince: number | null = null;
  private lookAwayTimestamps: number[] = [];

  // Client-side rate-limiter per event type
  private lastEmittedAt: Record<string, number> = {};

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 64;
    this.canvas.height = 48;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  public async init(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

      // 1. Initialize FaceDetector (GPU with CPU fallback)
      try {
        this.faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "IMAGE",
        });
      } catch {
        this.faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/blaze_face_short_range.tflite",
            delegate: "CPU",
          },
          runningMode: "IMAGE",
        });
      }

      // 2. Initialize ObjectDetector (GPU with CPU fallback)
      try {
        this.objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/efficientdet_lite0.tflite",
            delegate: "GPU",
          },
          scoreThreshold: 0.35,
          runningMode: "IMAGE",
        });
      } catch {
        this.objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/efficientdet_lite0.tflite",
            delegate: "CPU",
          },
          scoreThreshold: 0.35,
          runningMode: "IMAGE",
        });
      }
    } catch (err) {
      console.error("Failed to initialize MediaPipe vision tasks:", err);
      throw err;
    }
  }

  public start(
    video: HTMLVideoElement,
    onEvent: ProctorEventCallback,
    onTelemetry?: ProctorTelemetryCallback
  ): void {
    this.stop();

    // Run 1 frame per second (1 FPS)
    this.intervalTimer = setInterval(() => {
      this.tick(video, onEvent, onTelemetry);
    }, 1000);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.resetSustainedStates();
  }

  private resetSustainedStates(): void {
    this.noFaceSince = null;
    this.multiFaceSince = null;
    this.phoneSince = null;
    this.bookSince = null;
    this.cameraBlockedSince = null;
    this.lookAwayTimestamps = [];
  }

  private emit(
    type: string,
    meta: { confidence?: number; durationMs?: number },
    onEvent: ProctorEventCallback
  ): void {
    const now = Date.now();
    const last = this.lastEmittedAt[type] || 0;
    const cooldown = CLIENT_COOLDOWNS[type] || 15_000;

    // Enforce cooldown per event type
    if (now - last < cooldown) {
      return;
    }

    this.lastEmittedAt[type] = now;
    onEvent({
      type,
      confidence: meta.confidence,
      durationMs: meta.durationMs,
    });
  }

  private tick(
    video: HTMLVideoElement,
    onEvent: ProctorEventCallback,
    onTelemetry?: ProctorTelemetryCallback
  ): void {
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }

    const now = Date.now();
    let facesCount = 1; // default assumption if detector initializing
    let cellPhoneDetected = false;
    let bookDetected = false;
    let noFaceDurationMs = 0;

    // 1. Check average brightness for camera blockage
    const avgBrightness = this.calculateAverageBrightness(video);
    if (avgBrightness < 18) {
      if (!this.cameraBlockedSince) this.cameraBlockedSince = now;
      const duration = now - this.cameraBlockedSince;
      if (duration >= 3000) {
        this.emit("CAMERA_BLOCKED", { confidence: 1, durationMs: duration }, onEvent);
      }
    } else {
      this.cameraBlockedSince = null;
    }

    // 2. Face Detection & Pose Look-Away Check
    if (this.faceDetector) {
      try {
        const faceResult = this.faceDetector.detect(video);
        const faces = faceResult.detections || [];
        facesCount = faces.length;

        // NO_FACE: triggers strike after 4 seconds of continuous absence,
        // and re-triggers every 12 seconds if face continues to be absent
        if (facesCount === 0) {
          if (!this.noFaceSince) this.noFaceSince = now;
          noFaceDurationMs = now - this.noFaceSince;
          if (noFaceDurationMs >= 4000) {
            this.emit("NO_FACE", { confidence: 1, durationMs: noFaceDurationMs }, onEvent);
          }
        } else {
          this.noFaceSince = null;
        }

        // MULTI_FACE sustained 2s
        if (facesCount > 1) {
          if (!this.multiFaceSince) this.multiFaceSince = now;
          const duration = now - this.multiFaceSince;
          if (duration >= 2000) {
            this.emit("MULTI_FACE", { confidence: 1, durationMs: duration }, onEvent);
          }
        } else {
          this.multiFaceSince = null;
        }

        // LOOK_AWAY: nose offset vs eyes yaw > 0.35 repeated ~5 times in 2 minutes
        if (facesCount === 1 && faces[0].keypoints && faces[0].keypoints.length >= 3) {
          const kp = faces[0].keypoints;
          const rightEye = kp[0];
          const leftEye = kp[1];
          const nose = kp[2];

          if (rightEye && leftEye && nose) {
            const xMid = (rightEye.x + leftEye.x) / 2;
            const eyeDist = Math.abs(leftEye.x - rightEye.x);
            if (eyeDist > 0.01) {
              const yaw = Math.abs(nose.x - xMid) / eyeDist;
              if (yaw > 0.35) {
                this.lookAwayTimestamps.push(now);
              }
            }
          }
        }

        // Purge timestamps older than 2 minutes (120s)
        this.lookAwayTimestamps = this.lookAwayTimestamps.filter((t) => now - t <= 120_000);
        if (this.lookAwayTimestamps.length >= 5) {
          this.emit("LOOK_AWAY", { confidence: 0.85, durationMs: 4000 }, onEvent);
          this.lookAwayTimestamps = this.lookAwayTimestamps.slice(3);
        }
      } catch (err) {
        // Suppress frame processing error
      }
    }

    // 3. Object Detection (Cell Phone & Book)
    if (this.objectDetector) {
      try {
        const objResult = this.objectDetector.detect(video);
        const detections = objResult.detections || [];
        let cellPhoneScore = 0;
        let bookScore = 0;

        for (const det of detections) {
          for (const cat of det.categories) {
            const name = (cat.categoryName || "").toLowerCase();
            const isPhone =
              name === "cell phone" ||
              name === "mobile phone" ||
              name === "phone" ||
              name === "cellphone" ||
              name === "telephone" ||
              name === "remote" ||
              name === "remote control";
            if (isPhone && cat.score >= 0.35) {
              cellPhoneDetected = true;
              cellPhoneScore = Math.max(cellPhoneScore, cat.score);
            } else if (name === "book" || name === "notebook" || name === "binder") {
              bookDetected = true;
              bookScore = Math.max(bookScore, cat.score);
            }
          }
        }

        // PHONE_OBJECT: require 1.5s of continuous detection before strike
        if (cellPhoneDetected) {
          if (!this.phoneSince) this.phoneSince = now;
          const duration = now - this.phoneSince;
          if (duration >= 1500) {
            this.emit("PHONE_OBJECT", { confidence: cellPhoneScore, durationMs: duration }, onEvent);
          }
        } else {
          this.phoneSince = null;
        }

        // BOOK_OBJECT sustained 3s
        if (bookDetected) {
          if (!this.bookSince) this.bookSince = now;
          const duration = now - this.bookSince;
          if (duration >= 3000) {
            this.emit("BOOK_OBJECT", { confidence: bookScore, durationMs: duration }, onEvent);
          }
        } else {
          this.bookSince = null;
        }
      } catch (err) {
        // Suppress frame processing error
      }
    }

    // 4. Send realtime telemetry callback for immediate HUD update on mobile
    if (onTelemetry) {
      let statusText = "Normal • Desk Monitored";
      let violationState: "normal" | "warning" | "strike" = "normal";

      if (avgBrightness < 18) {
        statusText = "Camera Obstructed / Covered";
        violationState = (now - (this.cameraBlockedSince || now)) >= 3000 ? "strike" : "warning";
      } else if (cellPhoneDetected) {
        statusText = "Unauthorized Phone Detected - Strike";
        violationState = "strike";
      } else if (bookDetected) {
        statusText = "Book / Material Detected";
        violationState = (now - (this.bookSince || now)) >= 3000 ? "strike" : "warning";
      } else if (facesCount === 0) {
        const sec = Math.ceil(noFaceDurationMs / 1000);
        statusText = noFaceDurationMs >= 4000 ? `Face Missing (${sec}s) - Strike` : `Face Not Detected (${sec}s)`;
        violationState = noFaceDurationMs >= 4000 ? "strike" : "warning";
      } else if (facesCount > 1) {
        statusText = `Multiple Faces in View (${facesCount})`;
        violationState = (now - (this.multiFaceSince || now)) >= 2000 ? "strike" : "warning";
      }

      onTelemetry({
        faceCount: facesCount,
        noFaceDurationMs,
        cameraBlocked: avgBrightness < 18,
        phoneDetected: cellPhoneDetected,
        bookDetected,
        avgBrightness,
        statusText,
        violationState,
      });
    }
  }

  private calculateAverageBrightness(video: HTMLVideoElement): number {
    if (!this.ctx) return 100;
    try {
      this.ctx.drawImage(video, 0, 0, 64, 48);
      const imgData = this.ctx.getImageData(0, 0, 64, 48).data;
      let totalLuminance = 0;
      const count = imgData.length / 4;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
      }

      return totalLuminance / count;
    } catch {
      return 100;
    }
  }
}
