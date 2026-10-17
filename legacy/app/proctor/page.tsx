"use client";

import React, { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProctorVisionDetector, ProctorEventPayload, ProctorTelemetry } from "./detector";
import {
  keepAwake,
  watchOrientation,
  checkMotionPermission,
  requestOrientationPermission,
} from "./keepAwake";

// Clean SVG Icons
function IconShield({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconCamera({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function IconActivity({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconCpu({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconAlertTriangle({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconFlip({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function IconLaptop({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

const REASON_LABELS: Record<string, string> = {
  NO_FACE: "Face Not Visible in Camera",
  MULTI_FACE: "Multiple People in Frame",
  PHONE_OBJECT: "Unauthorized Mobile Phone Detected",
  BOOK_OBJECT: "Unauthorized Notes / Book Detected",
  LOOK_AWAY: "Frequent Looking Away Detected",
  CAMERA_BLOCKED: "Camera Obstructed or Covered",
  DEVICE_MOVED: "Phone Position Shifted on Desk",
  PAGE_HIDDEN: "Browser Backgrounded or Minimized",
  HEARTBEAT_LOST: "Device Connection Interrupted",
};

function ProctorClientContent() {
  const searchParams = useSearchParams();
  const pairToken = searchParams.get("token");

  // Authentication State
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(true);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Hardware State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [motionGranted, setMotionGranted] = useState(false);
  const [detectorReady, setDetectorReady] = useState(false);

  // Session State
  const [isRunning, setIsRunning] = useState(false);
  const [isExamActive, setIsExamActive] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  // Telemetry & Strikes
  const [telemetry, setTelemetry] = useState<ProctorTelemetry | null>(null);
  const [phoneStrikes, setPhoneStrikes] = useState<number>(0);
  const [activeAlert, setActiveAlert] = useState<{ message: string; type: string } | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ProctorVisionDetector | null>(null);
  const cleanupAwakeRef = useRef<(() => void) | null>(null);
  const cleanupOrientationRef = useRef<(() => void) | null>(null);
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isExamActiveRef = useRef<boolean>(false);

  // 1. Claim Pair Token
  useEffect(() => {
    if (!pairToken) {
      setClaimError("Missing pairing token. Please scan the QR code from the laptop test screen.");
      setClaimLoading(false);
      return;
    }

    let isDisposed = false;
    const claimToken = async () => {
      try {
        const res = await fetch("/api/proctor/pair/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: pairToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error?.message || data.error || "Failed to pair device. Link may have expired.");
        }

        if (isDisposed) return;
        setDeviceToken(data.data.deviceToken);
        setClaimLoading(false);
      } catch (err: any) {
        if (isDisposed) return;
        setClaimError(err.message || "Failed to connect to proctoring session.");
        setClaimLoading(false);
      }
    };

    claimToken();
    return () => {
      isDisposed = true;
    };
  }, [pairToken]);

  // 2. Battery Monitoring
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery?.().then((bat: any) => {
        setBatteryLevel(Math.round(bat.level * 100));
        bat.addEventListener("levelchange", () => {
          setBatteryLevel(Math.round(bat.level * 100));
        });
      }).catch(() => {});
    }
  }, []);

  // 3. Motion Sensor Check (Mandatory)
  useEffect(() => {
    checkMotionPermission().then((state) => {
      if (state === "granted") {
        setMotionGranted(true);
      }
    });
  }, []);

  const handleAuthorizeMotion = async () => {
    const granted = await requestOrientationPermission();
    setMotionGranted(granted);
  };

  // 4. Camera Stream Setup
  const startCamera = useCallback(async (mode: "environment" | "user") => {
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch {
      setCameraActive(false);
      setCameraError("Camera permission denied. Please allow camera access in browser settings.");
    }
  }, []);

  useEffect(() => {
    if (!claimLoading && !claimError) {
      startCamera(facingMode);
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [claimLoading, claimError, facingMode, startCamera]);

  // 5. Initialize On-Device MediaPipe Vision
  useEffect(() => {
    if (claimLoading || claimError) return;

    const detector = new ProctorVisionDetector();
    detectorRef.current = detector;

    detector
      .init()
      .then(() => setDetectorReady(true))
      .catch(() => setDetectorReady(true));

    return () => {
      detector.stop();
    };
  }, [claimLoading, claimError]);

  // 6. Handle Violation Event
  const handleProctorEvent = useCallback(
    async (event: ProctorEventPayload) => {
      // Do not process or record violation events before candidate starts the exam on laptop
      if (!deviceToken || isTerminated || isCompleted || !isExamActiveRef.current) return;

      const label = REASON_LABELS[event.type] || event.type;
      setActiveAlert({ message: label, type: event.type });

      try {
        if ("vibrate" in navigator) {
          navigator.vibrate([200, 100, 200]);
        }
      } catch {}

      try {
        const res = await fetch("/api/proctor/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: deviceToken,
            type: event.type,
            confidence: event.confidence,
            durationMs: event.durationMs,
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (typeof data.data?.strikes === "number") {
          setPhoneStrikes(data.data.strikes);
        }
        if (data.data?.terminate || (data.data?.strikes && data.data.strikes >= 5)) {
          setIsTerminated(true);
          detectorRef.current?.stop();
        }
      } catch {}
    },
    [deviceToken, isTerminated, isCompleted]
  );

  useEffect(() => {
    if (!activeAlert) return;
    const t = setTimeout(() => setActiveAlert(null), 5000);
    return () => clearTimeout(t);
  }, [activeAlert]);

  // 7. Start Active Desk Monitoring
  const handleStartMonitoring = async () => {
    if (!cameraActive || !detectorReady || !motionGranted || !videoRef.current || !deviceToken) return;

    // Notify server immediately that phone is in position and active
    try {
      await fetch("/api/proctor/pair/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: deviceToken }),
      });
    } catch {}

    setIsRunning(true);

    // Start vision detector
    if (detectorRef.current && videoRef.current) {
      detectorRef.current.start(videoRef.current, handleProctorEvent, (t) => {
        setTelemetry(t);
      });
    }

    // Keep awake & watch tab visibility
    cleanupAwakeRef.current = keepAwake(() => {
      handleProctorEvent({ type: "PAGE_HIDDEN", durationMs: 4000 });
    });

    // Device orientation watcher
    cleanupOrientationRef.current = watchOrientation(() => {
      handleProctorEvent({ type: "DEVICE_MOVED", durationMs: 2000 });
    });

    // Robust 2.5s Sync Loop
    syncTimerRef.current = setInterval(async () => {
      if (!deviceToken) return;
      try {
        const res = await fetch("/api/proctor/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: deviceToken }),
        });
        const data = await res.json().catch(() => ({}));

        if (data.success && data.data) {
          if (typeof data.data.strikes === "number") {
            setPhoneStrikes(data.data.strikes);
          }

          const currentActive = Boolean(data.data.isExamActive);
          setIsExamActive(currentActive);
          isExamActiveRef.current = currentActive;

          // Check if quota reached (5 strikes or proctor termination)
          // Strictly only terminate if the exam was active
          if (currentActive && (data.data.terminate || (typeof data.data.strikes === "number" && data.data.strikes >= 5))) {
            setIsTerminated(true);
            detectorRef.current?.stop();
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((t) => t.stop());
            }
          } else if (data.data.completed) {
            // Exam finished normally on laptop
            setIsCompleted(true);
            detectorRef.current?.stop();
            if (streamRef.current) {
              streamRef.current.getTracks().forEach((t) => t.stop());
            }
          }
        }
      } catch {}
    }, 2500);

    // Elapsed timer
    clockTimerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      cleanupAwakeRef.current?.();
      cleanupOrientationRef.current?.();
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (clockTimerRef.current) clearInterval(clockTimerRef.current);
      detectorRef.current?.stop();
    };
  }, []);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const isSetupReady = cameraActive && detectorReady && motionGranted;

  // ================= VIEW: LOADING =================
  if (claimLoading) {
    return (
      <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin mb-4" />
        <h2 className="text-sm font-semibold tracking-wide text-zinc-900">Connecting Device</h2>
        <p className="text-xs text-zinc-500 mt-1">Establishing encrypted proctoring session...</p>
      </div>
    );
  }

  // ================= VIEW: ERROR =================
  if (claimError) {
    return (
      <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mb-4">
          <IconAlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-bold text-red-700">Connection Failed</h2>
        <p className="text-xs text-zinc-600 mt-2 max-w-xs leading-relaxed">{claimError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 px-4 py-2 bg-zinc-900 hover:bg-black text-white rounded-lg text-xs font-medium transition cursor-pointer"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  // ================= VIEW: TERMINATED BY PROCTOR (5 STRIKES) =================
  if (isTerminated) {
    return (
      <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mb-4">
          <IconAlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-red-700">Proctor Quota Exceeded</h2>
        <div className="text-xs font-mono bg-red-600 text-white font-bold px-3 py-1 rounded-full mt-2">
          5 of 5 Strikes Reached
        </div>
        <p className="text-xs text-zinc-600 mt-3 max-w-xs leading-relaxed">
          The assessment session has concluded automatically. All responses recorded on your laptop prior to this event have been locked and submitted.
        </p>
      </div>
    );
  }

  // ================= VIEW: TEST COMPLETED =================
  if (isCompleted) {
    return (
      <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
        <div className="w-12 h-12 rounded-xl bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-900 mb-4">
          <IconCheck className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-zinc-900">Assessment Concluded</h2>
        <p className="text-xs text-zinc-600 mt-2 max-w-xs leading-relaxed">
          Your examination has been successfully submitted on your laptop. Desk monitoring is complete. You may close this tab.
        </p>
      </div>
    );
  }

  // ================= MAIN SCREEN (LIGHT MONOCHROME, SINGLE-HEIGHT) =================
  return (
    <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex flex-col justify-between p-4 overflow-hidden select-none font-sans">
      {!isRunning ? (
        // ------------------ SETUP SCREEN ------------------
        <div className="h-full flex flex-col justify-between">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
            <div className="flex items-center gap-2">
              <IconShield className="w-4 h-4 text-zinc-700" />
              <div>
                <h1 className="text-xs font-bold tracking-tight text-zinc-900 uppercase">MITAOE Secondary Proctor</h1>
                <p className="text-[11px] text-zinc-500">Desk Environment Setup</p>
              </div>
            </div>
            <span className="text-[10px] bg-zinc-100 text-zinc-800 border border-zinc-300 px-2 py-0.5 rounded font-mono font-medium">
              Paired
            </span>
          </div>

          {/* Central Camera Video View with Framing Guide */}
          <div className="flex-1 my-3 min-h-0 relative rounded-xl overflow-hidden bg-black border border-zinc-200 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Overlaid Guide */}
            <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
              <div className="flex justify-between items-center text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="bg-black/75 border border-white/20 px-2 py-0.5 rounded text-white font-medium">
                    45° Desk Angle
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSetupGuide(true)}
                    className="pointer-events-auto bg-black/75 hover:bg-black px-2 py-0.5 rounded text-white text-[10px] font-mono border border-white/20 flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>View Demo</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))}
                  className="pointer-events-auto bg-black/75 hover:bg-black px-2.5 py-1 rounded text-white text-[10px] font-mono border border-white/20 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <IconFlip className="w-3 h-3" />
                  <span>{facingMode === "environment" ? "Back" : "Front"}</span>
                </button>
              </div>

              <div className="bg-black/80 border border-white/20 text-white/95 text-[10px] py-1.5 px-3 rounded-lg text-center font-mono mx-auto max-w-xs font-medium">
                Ensure hands, keyboard and profile are in frame
              </div>
            </div>

            {cameraError && (
              <div className="absolute inset-0 bg-white/95 p-4 flex flex-col items-center justify-center text-center">
                <IconAlertTriangle className="w-6 h-6 text-red-600 mb-2" />
                <span className="text-red-700 text-xs font-medium">{cameraError}</span>
              </div>
            )}
          </div>

          {/* Mandatory Readiness Checklist */}
          <div className="space-y-1.5 py-1">
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              {/* 1. Camera */}
              <div className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 ${
                cameraActive
                  ? "bg-zinc-900 text-white border-zinc-900 font-medium"
                  : "bg-zinc-50 border-zinc-200 text-zinc-400"
              }`}>
                {cameraActive ? <IconCheck className="w-3.5 h-3.5" /> : <IconCamera className="w-3.5 h-3.5" />}
                <span>Camera</span>
              </div>

              {/* 2. Vision Tasks */}
              <div className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 ${
                detectorReady
                  ? "bg-zinc-900 text-white border-zinc-900 font-medium"
                  : "bg-zinc-50 border-zinc-200 text-zinc-400"
              }`}>
                {detectorReady ? <IconCheck className="w-3.5 h-3.5" /> : <IconCpu className="w-3.5 h-3.5" />}
                <span>Vision</span>
              </div>

              {/* 3. Motion Sensors (Mandatory) */}
              <div className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 ${
                motionGranted
                  ? "bg-zinc-900 text-white border-zinc-900 font-medium"
                  : "bg-zinc-50 border-zinc-200 text-zinc-400"
              }`}>
                {motionGranted ? <IconCheck className="w-3.5 h-3.5" /> : <IconActivity className="w-3.5 h-3.5" />}
                <span>Motion</span>
              </div>
            </div>

            {/* Motion Sensor Mandatory Prompt */}
            {!motionGranted && (
              <div className="p-2.5 bg-zinc-100 border border-zinc-200 rounded-lg flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-700">
                  <IconActivity className="w-4 h-4 text-zinc-600 shrink-0" />
                  <span className="font-medium">Motion sensor required to verify stationary placement</span>
                </div>
                <button
                  type="button"
                  onClick={handleAuthorizeMotion}
                  className="px-2.5 py-1 bg-zinc-900 hover:bg-black text-white rounded text-[11px] font-semibold transition cursor-pointer"
                >
                  Enable Sensor
                </button>
              </div>
            )}
          </div>

          {/* Action Button */}
          <div className="pt-2">
            <button
              onClick={handleStartMonitoring}
              disabled={!isSetupReady}
              className={`w-full py-3.5 rounded-xl font-semibold text-xs tracking-wider uppercase transition ${
                isSetupReady
                  ? "bg-zinc-900 text-white hover:bg-black active:scale-[0.98] cursor-pointer"
                  : "bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-not-allowed"
              }`}
            >
              {isSetupReady
                ? "I am in position — Start Monitoring"
                : !motionGranted
                ? "Enable Motion Sensor to Continue"
                : "Initializing Sensors..."}
            </button>
          </div>
        </div>
      ) : (
        // ------------------ RUNNING SCREEN (LIGHT MONOCHROME HUD) ------------------
        <div className="h-full flex flex-col justify-between">
          {/* Top Status Bar */}
          <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-900 animate-pulse" />
              <span className="text-xs font-semibold tracking-wide text-zinc-900">
                {isExamActive ? "Desk Proctor Active" : "Monitoring Ready"}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              {isExamActive ? (
                <span className="text-zinc-900 font-bold">{formatElapsed(elapsedSeconds)}</span>
              ) : (
                <span className="text-zinc-500 text-[11px]">Ready</span>
              )}
              {batteryLevel !== null && (
                <span className="text-zinc-500 text-[11px] font-medium">{batteryLevel}%</span>
              )}
            </div>
          </div>

          {/* Central Video View HUD */}
          <div className="flex-1 my-2 min-h-0 relative rounded-xl overflow-hidden bg-black border border-zinc-200 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Overlaid Live Badges */}
            <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
              {/* Top Row: Face Status & Flip */}
              <div className="flex items-center justify-between">
                <div
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-md border flex items-center gap-1.5 ${
                    telemetry && telemetry.faceCount === 1
                      ? "bg-black/75 border-white/20 text-white"
                      : "bg-red-600 border-red-700 text-white font-bold"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${telemetry && telemetry.faceCount === 1 ? "bg-white" : "bg-white animate-pulse"}`} />
                  <span>
                    {telemetry && telemetry.faceCount === 1
                      ? "Face Verified"
                      : telemetry && telemetry.noFaceDurationMs > 0
                      ? `No Face Detected (${Math.ceil(telemetry.noFaceDurationMs / 1000)}s)`
                      : "No Face in View"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))}
                  className="pointer-events-auto bg-black/75 hover:bg-black px-2 py-0.5 rounded text-[10px] font-mono text-white border border-white/20 flex items-center gap-1 transition cursor-pointer"
                >
                  <IconFlip className="w-3 h-3" />
                  <span>Flip</span>
                </button>
              </div>

              {/* Bottom Row inside video: Current status text */}
              <div className="bg-black/80 border border-white/20 px-2.5 py-1 rounded-md text-[10px] font-mono flex items-center justify-between text-white/90">
                <span className="truncate">
                  {telemetry?.statusText || "Analysing desk frame..."}
                </span>
                <span className="text-zinc-400 shrink-0 ml-1">1 FPS</span>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="space-y-2 pt-1">
            {/* If still waiting for student to click Start Test on laptop */}
            {!isExamActive ? (
              <div className="p-3 bg-zinc-100 border border-zinc-200 rounded-xl flex items-center gap-3">
                <div className="p-2 rounded-lg bg-zinc-200 text-zinc-800 shrink-0">
                  <IconLaptop className="w-5 h-5" />
                </div>
                <div className="text-xs">
                  <span className="font-semibold text-zinc-900 block">Awaiting Test Start on Laptop</span>
                  <p className="text-zinc-600 text-[11px] leading-relaxed mt-0.5">
                    Position confirmed. Return to your laptop, accept the rules, and click &quot;Start test&quot;.
                  </p>
                </div>
              </div>
            ) : activeAlert ? (
              // Live Active Violation Banner - Standard Danger Red
              <div className="p-2.5 bg-red-600 text-white rounded-xl flex items-center justify-between text-xs shadow-sm">
                <div className="flex items-center gap-2">
                  <IconAlertTriangle className="w-4 h-4 text-white shrink-0" />
                  <div>
                    <span className="font-bold text-white/90 block text-[10px] uppercase tracking-wider">
                      Proctor Violation
                    </span>
                    <span className="text-white text-xs font-semibold">{activeAlert.message}</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-white text-red-700 font-bold px-2 py-0.5 rounded shadow-xs shrink-0">
                  +Strike
                </span>
              </div>
            ) : (
              <div className="p-2 bg-zinc-100 border border-zinc-200 rounded-xl flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-zinc-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                  <span className="font-medium">Desk monitoring active. Keep phone stationary.</span>
                </div>
                <span className="text-zinc-500 font-mono text-[10px] uppercase font-semibold">Active</span>
              </div>
            )}

            {/* Strikes HUD Counter */}
            <div className="p-2.5 bg-zinc-100 border border-zinc-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-800">Phone Strikes:</span>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full border transition-all ${
                        i < phoneStrikes
                          ? "bg-red-600 border-red-700"
                          : "bg-zinc-300 border-zinc-300"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <span className={`text-xs font-mono font-bold ${phoneStrikes > 0 ? "text-red-600" : "text-zinc-600"}`}>
                {phoneStrikes} / 5
              </span>
            </div>

            <div className="text-[10px] text-zinc-400 font-mono text-center">
              MIT Academy of Engineering • Placement Assessment
            </div>
          </div>
        </div>
      )}

      {/* Visual Setup Standard Modal */}
      {showSetupGuide && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
              <div>
                <h3 className="font-bold text-sm text-zinc-900">
                  Desk Camera Setup Standard
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Official positioning reference
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSetupGuide(false)}
                className="text-zinc-400 hover:text-zinc-900 text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-zinc-200">
              <video
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              >
                <source src="/videos/proctor-setup.mp4" type="video/mp4" />
                <img
                  src="/images/proctor-setup.gif"
                  alt="Proctoring Setup Demonstration"
                  className="w-full h-full object-cover"
                />
              </video>
            </div>

            <ul className="text-[11px] text-zinc-600 space-y-1.5 list-disc list-inside leading-snug">
              <li>Place phone on a stand or prop 2–3 feet to your side.</li>
              <li>Angle camera at 45° to view hands and laptop keyboard.</li>
              <li>Keep phone steady on desk throughout the examination.</li>
            </ul>

            <button
              type="button"
              onClick={() => setShowSetupGuide(false)}
              className="w-full py-2.5 bg-zinc-900 hover:bg-black text-white rounded-xl text-xs font-semibold tracking-wide uppercase transition cursor-pointer"
            >
              Got It — Return to Camera
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProctorPage() {
  return (
    <Suspense
      fallback={
        <div className="h-[100dvh] max-h-[100dvh] bg-white text-zinc-900 flex items-center justify-center p-6 text-center overflow-hidden">
          <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin mb-2" />
          <p className="text-xs text-zinc-500">Loading Desk Proctor...</p>
        </div>
      }
    >
      <ProctorClientContent />
    </Suspense>
  );
}
