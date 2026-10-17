"use client";

import React, { useEffect, useState, use, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { Navbar } from "@/components/ui/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { apiClient } from "@/lib/apiClient";
import { useFaceMonitor } from "@/hooks/useFaceMonitor";
import { QRCodeDisplay } from "@/components/proctor/QRCodeDisplay";
import { Series, StudentTestView } from "@/types";

export default function ExamRulesPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  const { testId } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [test, setTest] = useState<StudentTestView | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hardware readiness checks
  const [viewportOk, setViewportOk] = useState(true);
  const [fullscreenOk, setFullscreenOk] = useState(true);
  const [onlineOk, setOnlineOk] = useState(true);

  // Window Management & Multiple Screens State
  const [screensStatus, setScreensStatus] = useState<
    "checking" | "prompt" | "single" | "multiple" | "unsupported"
  >("checking");
  const [screenCount, setScreenCount] = useState<number>(1);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [isRequestingScreen, setIsRequestingScreen] = useState(false);

  // Secondary Mobile Proctor State
  const [pairingSessionId, setPairingSessionId] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string>("");
  const [customHost, setCustomHost] = useState<string>("");
  const [mobilePaired, setMobilePaired] = useState(false);
  const [mobileActive, setMobileActive] = useState(false);
  const [mobileConnected, setMobileConnected] = useState(false);
  const [mobilePhoneState, setMobilePhoneState] = useState<{
    battery?: number | null;
    inForeground?: boolean;
    cameraOk?: boolean;
  } | null>(null);

  // Camera & Face detection monitor
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const {
    detectorReady,
    hasPermission,
    faceCount,
    requestCamera,
    switchCamera,
    videoDevices,
    selectedDeviceId,
  } = useFaceMonitor({
    isActive: true,
    videoRef: cameraVideoRef,
  });

  // Launch interaction states
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Auto-suggest display verification modal when permission is required
  useEffect(() => {
    if (screensStatus === "prompt") {
      const timer = setTimeout(() => {
        setShowVerifyModal(true);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setShowVerifyModal(false);
    }
  }, [screensStatus]);

  const checkScreenConfiguration = async (requestPrompt = false) => {
    if (typeof window === "undefined") return;

    if (!("getScreenDetails" in window)) {
      const isExtended = !!(window.screen as any)?.isExtended;
      if (isExtended) {
        setScreensStatus("multiple");
        setScreenCount(2);
      } else {
        setScreensStatus("single");
        setScreenCount(1);
      }
      setShowVerifyModal(false);
      return;
    }

    try {
      if (requestPrompt) {
        setIsRequestingScreen(true);
      }
      let permState = "prompt";
      if (navigator.permissions && (navigator.permissions as any).query) {
        try {
          const res = await (navigator.permissions as any).query({
            name: "window-management",
          });
          permState = res.state;
        } catch {
          try {
            const res = await (navigator.permissions as any).query({
              name: "window-placement",
            });
            permState = res.state;
          } catch {}
        }
      }

      if (permState === "granted" || requestPrompt) {
        const details = await (window as any).getScreenDetails();
        const count = details.screens ? details.screens.length : 1;
        setScreenCount(count);
        setScreensStatus(count > 1 ? "multiple" : "single");
        setShowVerifyModal(false);

        details.addEventListener("screenschange", () => {
          const newCount = details.screens ? details.screens.length : 1;
          setScreenCount(newCount);
          setScreensStatus(newCount > 1 ? "multiple" : "single");
        });
      } else if (permState === "prompt") {
        setScreensStatus("prompt");
      } else {
        const isExtended = !!(window.screen as any)?.isExtended;
        if (isExtended) {
          setScreensStatus("multiple");
          setScreenCount(2);
        } else {
          setScreensStatus("single");
          setScreenCount(1);
        }
        setShowVerifyModal(false);
      }
    } catch {
      const isExtended = !!(window.screen as any)?.isExtended;
      if (isExtended) {
        setScreensStatus("multiple");
        setScreenCount(2);
      } else {
        setScreensStatus("single");
        setScreenCount(1);
      }
      setShowVerifyModal(false);
    } finally {
      setIsRequestingScreen(false);
    }
  };

  useEffect(() => {
    // 1. Viewport verification (>= 1024px)
    const checkViewport = () => {
      setViewportOk(window.innerWidth >= 1024);
    };
    checkViewport();
    window.addEventListener("resize", checkViewport);

    // 2. Fullscreen capability
    setFullscreenOk(!!document.fullscreenEnabled);

    // 3. Network link
    setOnlineOk(navigator.onLine);
    const handleOnline = () => setOnlineOk(true);
    const handleOffline = () => setOnlineOk(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 4. Multiple Screens Verification via Window Management API
    checkScreenConfiguration(false);

    // Fetch test & series details
    const loadTestConfig = async () => {
      try {
        const data = await apiClient.get<{
          series: Series | null;
          tests: StudentTestView[];
        }>("/api/series/active");

        setSeries(data.series);
        const currentTest = data.tests.find((t) => t.id === testId);
        if (!currentTest) {
          setError("Assessment session not found or currently inactive.");
        } else {
          setTest(currentTest);
          if (currentTest.userAttempt?.status === "in_progress") {
            router.replace(`/tests/${testId}/exam`);
            return;
          }
          if (
            currentTest.userAttempt?.status === "submitted" ||
            currentTest.userAttempt?.status === "auto_submitted" ||
            currentTest.userAttempt?.status === "terminated_by_proctor"
          ) {
            router.replace(`/dashboard`);
            return;
          }
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load test parameters.");
      } finally {
        setLoading(false);
      }
    };

    loadTestConfig();

    return () => {
      window.removeEventListener("resize", checkViewport);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [testId]);

  useEffect(() => {
    requestCamera();
  }, [requestCamera]);

  const isMobileRequired =
    test?.effectiveSecondaryCameraRequired !== undefined
      ? test.effectiveSecondaryCameraRequired
      : test?.secondaryCameraRequired === false
      ? false
      : test?.secondaryCameraRequired === true
      ? true
      : series?.secondaryCameraRequired === false
      ? false
      : true;

  // Secondary phone monitoring is strictly required before start
  const requiresMobileMonitoring = Boolean(isMobileRequired);

  // Initialize Secondary Mobile Pairing Session
  useEffect(() => {
    if (!testId || !isMobileRequired) return;
    let isDisposed = false;

    const initPairing = async () => {
      try {
        const res = await apiClient.post<{ pairToken: string; attemptId: string }>("/api/proctor/pair/create", {
          testId,
        });
        if (isDisposed) return;
        setPairingSessionId(res.attemptId);
        setPairingToken(res.pairToken);

        const base = customHost.trim().replace(/\/$/, "") || window.location.origin;
        const url = `${base}/proctor?token=${encodeURIComponent(res.pairToken)}`;
        setPairingUrl(url);

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "proctor_mobile_session",
            JSON.stringify({ attemptId: res.attemptId, pairToken: res.pairToken, testId })
          );
          try {
            window.localStorage.setItem(
              `proctor_mobile_session_${testId}`,
              JSON.stringify({ attemptId: res.attemptId, pairToken: res.pairToken, testId })
            );
          } catch {}
        }
      } catch (err) {
        console.error("Failed to initialize secondary proctor session", err);
      }
    };

    initPairing();
    return () => {
      isDisposed = true;
    };
  }, [testId, customHost, isMobileRequired]);

  // Listen to pairing & active monitoring status on rules screen via fast 1s polling
  useEffect(() => {
    if (!isMobileRequired || (!pairingSessionId && !testId)) return;

    let isDisposed = false;
    const interval = setInterval(async () => {
      if (isDisposed) return;
      try {
        const res = await apiClient.get<{ paired: boolean; active?: boolean }>(
          `/api/proctor/pair/status?attemptId=${pairingSessionId || ""}&testId=${testId}`
        );
        if (res.paired) {
          setMobilePaired(true);
        }
        if (res.active) {
          setMobileActive(true);
          setMobileConnected(true);
        } else {
          setMobileActive(false);
          setMobileConnected(false);
        }
      } catch {}
    }, 1000);

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [pairingSessionId, testId, isMobileRequired]);

  const cameraOk = hasPermission === true && faceCount === 1;
  const screensVerified =
    screensStatus === "single" ||
    screensStatus === "multiple" ||
    screensStatus === "unsupported";

  const totalChecks = requiresMobileMonitoring ? 6 : 5;
  const passedChecksCount =
    (viewportOk ? 1 : 0) +
    (fullscreenOk ? 1 : 0) +
    (onlineOk ? 1 : 0) +
    (cameraOk ? 1 : 0) +
    (screensVerified ? 1 : 0) +
    (requiresMobileMonitoring ? (mobileActive ? 1 : 0) : 0);
  const allChecksPassed = passedChecksCount === totalChecks;
  const canStart = allChecksPassed && rulesAccepted && countdown === null;

  const handleStartClick = async () => {
    if (!canStart) return;
    if (requiresMobileMonitoring && !mobileActive) {
      alert("Please ensure your secondary phone is connected and tap 'Start Monitoring' on your phone before starting the test.");
      return;
    }

    // Cache multi-screen flag for attempt initialization and clear stale answers from prior attempts
    if (typeof window !== "undefined") {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key && key.startsWith("exam_answers_") && key.includes(testId)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
      } catch {}

      window.sessionStorage.setItem(
        "exam_multi_screen",
        JSON.stringify({
          multiScreen: screensStatus === "multiple",
          screenCount,
        })
      );
    }

    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser will enforce or prompt
    }

    let remaining = 3;
    setCountdown(remaining);

    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        router.push(`/tests/${testId}/exam`);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  return (
    <StudentGuard>
      <div className="min-h-screen bg-paper flex flex-col justify-between selection:bg-pen selection:text-white">
        <Navbar />

        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
          {loading ? (
            <div className="py-24 flex items-center justify-center gap-2.5 text-sm text-ink-muted">
              <span className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />
              <span>Loading assessment details...</span>
            </div>
          ) : error || !test || !series ? (
            <Card className="max-w-md mx-auto text-center space-y-3">
              <h2 className="font-semibold text-lg text-ink">
                Test unavailable
              </h2>
              <p className="text-xs text-ink-muted leading-relaxed">
                {error || "The requested assessment session is not available right now."}
              </p>
              <Link href="/dashboard">
                <Button variant="secondary" size="sm">Back to dashboard</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-8">
              {/* Header */}
              <div className="border-b border-line pb-6 space-y-3">
                <h1 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-5xl text-ink tracking-tight">
                  Test instructions and system check
                </h1>
                <p className="text-sm sm:text-base text-ink-muted max-w-3xl leading-relaxed">
                  Day {test.day} placement test for {test.company}. Review the test rules below and make sure your camera and display pass before starting.
                </p>

                {/* Parameters Table */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3">
                  <div className="border border-line rounded-xl p-4 bg-surface shadow-xs">
                    <span className="block text-sm font-medium text-ink-muted">Duration</span>
                    <span className="font-bold text-xl sm:text-2xl text-ink tabular-nums mt-1 block">
                      {test.effectiveDurationMin} minutes
                    </span>
                  </div>

                  <div className="border border-line rounded-xl p-4 bg-surface shadow-xs">
                    <span className="block text-sm font-medium text-ink-muted">Questions</span>
                    <span className="font-bold text-xl sm:text-2xl text-ink tabular-nums mt-1 block">
                      {test.questionCount > 0 ? test.questionCount : 30} MCQs
                    </span>
                  </div>

                  <div className="border border-line rounded-xl p-4 bg-surface shadow-xs">
                    <span className="block text-sm font-medium text-ink-muted">Max strikes</span>
                    <span className="font-bold text-xl sm:text-2xl text-ink tabular-nums mt-1 block">
                      {series.maxStrikes} warnings
                    </span>
                  </div>

                  <div className="border border-line rounded-xl p-4 bg-surface shadow-xs">
                    <span className="block text-sm font-medium text-ink-muted">Attempts</span>
                    <span className="font-bold text-xl sm:text-2xl text-ink mt-1 block">
                      1 attempt
                    </span>
                  </div>
                </div>
              </div>

              {/* Rules Grid */}
              <div className="space-y-4">
                <h2 className="font-display font-bold text-xl sm:text-2xl text-ink">
                  Test rules
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      Continuous timer
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      The timer runs continuously once started. Closing your browser or leaving the page does not pause the clock.
                    </p>
                  </Card>

                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      Fullscreen required
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      You must remain in fullscreen mode. Switching windows, opening tabs, or minimizing logs a strike.
                    </p>
                  </Card>

                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      No copy or paste
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Copying question text or pasting outside content is blocked and recorded.
                    </p>
                  </Card>

                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      Developer tools prohibited
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Opening inspection tools or developer consoles immediately submits your test.
                    </p>
                  </Card>

                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      Automatic submission at {series.maxStrikes} strikes
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      If you reach {series.maxStrikes} strikes, your test will submit automatically. Everything answered up to that point is saved.
                    </p>
                  </Card>

                  <Card className="p-5 sm:p-6 space-y-2">
                    <h3 className="font-bold text-base sm:text-lg text-ink">
                      Webcam presence
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Your webcam must stay on and you must be alone in view. Processing runs locally on your device; video is never uploaded.
                    </p>
                  </Card>
                </div>
              </div>

              {/* Dual-Device Proctoring Overview & Video Guide */}
              {isMobileRequired && (
                <Card className="p-6 sm:p-8 space-y-6 border-line bg-surface">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
                    <div>
                      <h2 className="font-display font-bold text-xl sm:text-2xl text-ink">
                        Dual-Device Proctoring Overview
                      </h2>
                      <p className="text-sm sm:text-base text-ink-muted mt-1 leading-normal">
                        How MITAOE Automated Examination Proctoring operates during your test.
                      </p>
                    </div>
                    <span className="text-sm bg-ink/5 border border-line text-ink px-3 py-1 rounded-md font-mono font-medium self-start sm:self-auto">
                      Two Independent Quotas
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    {/* Explanatory Video Player */}
                    <div className="lg:col-span-6 space-y-2.5">
                      <div className="relative aspect-video rounded-xl overflow-hidden bg-surface border border-line shadow-xs group">
                        <video
                          autoPlay
                          loop
                          muted
                          playsInline
                          disablePictureInPicture
                          className="w-full h-full object-cover"
                        >
                          <source src="/videos/proctor-setup.mp4" type="video/mp4" />
                          <img
                            src="/images/proctor-setup.gif"
                            alt="MITAOE Official Dual Proctoring Setup"
                            className="w-full h-full object-cover"
                          />
                        </video>
                        <div className="absolute top-3 left-3 bg-ink/80 backdrop-blur-xs text-paper text-xs font-mono px-2.5 py-1 rounded-md flex items-center gap-1.5 pointer-events-none">
                          <span>Setup Standard Demonstration</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs sm:text-sm text-ink-muted px-1 font-medium">
                        <span>Left: Front webcam eye-level</span>
                        <span>•</span>
                        <span>Right: Phone 45° desk angle</span>
                      </div>
                    </div>

                    {/* Architecture & Quota Breakdown */}
                    <div className="lg:col-span-6 space-y-4 text-sm sm:text-base">
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-base sm:text-lg text-ink">
                          Why two cameras?
                        </h4>
                        <p className="text-ink-muted text-sm sm:text-base leading-relaxed">
                          Industry-standard assessment integrity requires two distinct camera angles to verify genuine, unassisted candidate performance.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                        <div className="p-4 rounded-xl border border-line bg-paper space-y-1.5">
                          <span className="font-bold text-sm sm:text-base text-ink block">Laptop Webcam</span>
                          <p className="text-ink-muted text-xs sm:text-sm leading-relaxed">
                            Monitors facial presence, eye direction, and fullscreen window focus.
                          </p>
                          <span className="inline-block text-xs sm:text-sm font-mono text-ink mt-1 font-bold">
                            Quota: {series.maxStrikes} strikes
                          </span>
                        </div>

                        <div className="p-4 rounded-xl border border-line bg-paper space-y-1.5">
                          <span className="font-bold text-sm sm:text-base text-ink block">Desk Phone Camera</span>
                          <p className="text-ink-muted text-xs sm:text-sm leading-relaxed">
                            Placed 2–3 ft away at 45° to observe hands, desk surface, and keyboard.
                          </p>
                          <span className="inline-block text-xs sm:text-sm font-mono text-ink mt-1 font-bold">
                            Quota: 5 strikes
                          </span>
                        </div>
                      </div>

                      <div className="p-3 bg-paper rounded-xl border border-line text-xs sm:text-sm text-ink-muted leading-relaxed">
                        <strong className="text-ink font-bold">On-Device Privacy:</strong> All computer vision models run locally inside your browsers using TensorFlow Lite. No video streams or photos are ever recorded or transmitted over the network.
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* System Diagnostics & Launch Console */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pt-4 border-t border-line">
                {/* Diagnostics List */}
                <Card className="lg:col-span-7 space-y-5 p-6 sm:p-7">
                  <div className="flex items-center justify-between border-b border-line pb-3.5">
                    <div>
                      <h3 className="font-display font-bold text-xl sm:text-2xl text-ink">
                        System check
                      </h3>
                      <p className="text-sm text-ink-muted mt-1">
                        Your device must pass all checks before starting.
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-ink">
                      {allChecksPassed ? `${totalChecks} of ${totalChecks} passed` : `${passedChecksCount} of ${totalChecks} passed`}
                    </span>
                  </div>

                  <div className="space-y-3.5 text-sm">
                    {/* Viewport Check */}
                    <div className="flex items-center justify-between p-4 rounded-xl border border-line bg-paper gap-3">
                      <div>
                        <span className="font-bold text-base text-ink block">Screen resolution</span>
                        <span className="text-sm text-ink-muted leading-relaxed">
                          {viewportOk ? "Desktop viewport verified." : "Window is too narrow. Maximize browser or use a desktop/laptop."}
                        </span>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${viewportOk ? "text-green" : "text-red"}`}>
                        {viewportOk ? "Ready" : "Too small"}
                      </span>
                    </div>

                    {/* Fullscreen API */}
                    <div className="flex items-center justify-between p-4 rounded-xl border border-line bg-paper gap-3">
                      <div>
                        <span className="font-bold text-base text-ink block">Fullscreen support</span>
                        <span className="text-sm text-ink-muted leading-relaxed">
                          {fullscreenOk ? "Browser supports fullscreen lock." : "Fullscreen is disabled in browser."}
                        </span>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${fullscreenOk ? "text-green" : "text-red"}`}>
                        {fullscreenOk ? "Ready" : "Not supported"}
                      </span>
                    </div>

                    {/* Server Latency */}
                    <div className="flex items-center justify-between p-4 rounded-xl border border-line bg-paper gap-3">
                      <div>
                        <span className="font-bold text-base text-ink block">Server connection</span>
                        <span className="text-sm text-ink-muted leading-relaxed">
                          {onlineOk ? "Connected to assessment server." : "Offline. Check your internet connection."}
                        </span>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${onlineOk ? "text-green" : "text-red"}`}>
                        {onlineOk ? "Ready" : "Offline"}
                      </span>
                    </div>

                    {/* Camera Feed Check */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-line bg-paper gap-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-20 h-14 rounded-lg overflow-hidden border border-line bg-surface shrink-0 relative">
                          <video
                            ref={cameraVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          {!hasPermission && (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-muted bg-surface font-medium">
                              Off
                            </div>
                          )}
                        </div>

                        <div>
                          <span className="font-bold text-base text-ink block">
                            Webcam check
                          </span>
                          <span className="text-sm text-ink-muted leading-relaxed block mt-0.5">
                            {hasPermission === false ? (
                              <span className="text-red font-medium">Camera access blocked. Enable camera permissions and reload.</span>
                            ) : hasPermission === null ? (
                              "Starting camera..."
                            ) : faceCount === 0 ? (
                              <span className="text-ink-muted">No face detected. Sit upright in frame.</span>
                            ) : faceCount > 1 ? (
                              <span className="text-red font-medium">Multiple faces detected ({faceCount}). You must be alone.</span>
                            ) : (
                              "Single face verified in frame."
                            )}
                          </span>
                          {videoDevices.length > 1 && (
                            <div className="mt-2 flex items-center gap-2">
                              <label className="text-xs sm:text-sm font-medium text-ink-muted">Camera:</label>
                              <select
                                value={selectedDeviceId || ""}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    switchCamera(e.target.value);
                                  }
                                }}
                                className="text-xs sm:text-sm bg-surface border border-line rounded-lg px-2.5 py-1 text-ink focus:outline-none focus:border-pen max-w-[220px] truncate"
                              >
                                {videoDevices.map((d, i) => {
                                  const isVirtual = /obs|virtual|manycam|snap/i.test(d.label || "");
                                  return (
                                    <option key={d.deviceId || i} value={d.deviceId}>
                                      {d.label || `Camera ${i + 1}`} {isVirtual ? "(Virtual / OBS)" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                        {hasPermission === false && (
                          <button
                            type="button"
                            onClick={() => requestCamera()}
                            className="text-sm text-pen font-semibold hover:underline cursor-pointer"
                          >
                            Retry
                          </button>
                        )}
                        <span className={`text-sm font-bold ${cameraOk ? "text-green" : hasPermission === false ? "text-red" : "text-ink-muted"}`}>
                          {cameraOk ? "Ready" : hasPermission === false ? "Denied" : "Checking"}
                        </span>
                      </div>
                    </div>

                    {/* Display / Multiple Screens Check */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-line bg-paper gap-3.5">
                      <div>
                        <span className="font-bold text-base text-ink block">
                          Single display check
                        </span>
                        <span className="text-sm text-ink-muted leading-relaxed">
                          {screensStatus === "single" ? (
                            "Single monitor verified."
                          ) : screensStatus === "multiple" ? (
                            <span className="text-red font-semibold">
                              Multiple displays detected ({screenCount} monitors). Disconnect external monitors before starting.
                            </span>
                          ) : screensStatus === "prompt" ? (
                            <span className="text-ink-muted">
                              Display permission required to verify attached monitors.
                            </span>
                          ) : screensStatus === "unsupported" ? (
                            "Single display verified."
                          ) : (
                            "Checking connected displays..."
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                        {screensStatus === "prompt" && (
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => checkScreenConfiguration(true)}
                            loading={isRequestingScreen}
                            className="text-xs sm:text-sm font-semibold"
                          >
                            Verify display
                          </Button>
                        )}
                        <span className={`text-sm font-bold ${screensStatus === "single" || screensStatus === "unsupported" ? "text-green" : screensStatus === "multiple" ? "text-red" : "text-ink-muted"}`}>
                          {screensStatus === "single" || screensStatus === "unsupported"
                            ? "Ready"
                            : screensStatus === "multiple"
                            ? `Extra screen (${screenCount})`
                            : screensStatus === "prompt"
                            ? "Action required"
                            : "Checking"}
                        </span>
                      </div>
                    </div>

                    {/* Secondary Mobile Camera Check */}
                    {isMobileRequired && (
                      <div className="flex flex-col p-4 rounded-xl border border-line bg-paper gap-3.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-base text-ink block">
                                Secondary mobile camera
                              </span>
                              <span className="text-xs bg-pen/10 text-pen px-2 py-0.5 rounded font-bold">
                                Required
                              </span>
                            </div>
                            <span className="text-sm text-ink-muted leading-relaxed block mt-1">
                              {mobileActive ? (
                                <span className="text-green font-semibold">
                                  Secondary phone camera active and monitoring desk.
                                </span>
                              ) : mobilePaired ? (
                                <span className="text-ink font-semibold">
                                  Phone linked. Complete setup by pressing &quot;I am in position — Start Monitoring&quot; on your phone screen.
                                </span>
                              ) : requiresMobileMonitoring ? (
                                <span className="text-red font-semibold">
                                  Secondary phone connection required below before starting examination.
                                </span>
                              ) : (
                                "Scan QR code with smartphone to test side-angle desk monitoring."
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-sm font-bold ${
                                mobileActive
                                  ? "text-green"
                                  : mobilePaired
                                  ? "text-ink font-extrabold"
                                  : requiresMobileMonitoring
                                  ? "text-red"
                                  : "text-ink-muted"
                              }`}
                            >
                              {mobileActive
                                ? "Active & Monitored"
                                : mobilePaired
                                ? "Awaiting Phone Action"
                                : requiresMobileMonitoring
                                ? "Pairing required"
                                : "Not paired"}
                            </span>
                          </div>
                        </div>

                        {/* Phone Paired but Not Active yet: High-contrast institutional callout */}
                        {mobilePaired && !mobileActive && (
                          <div className="p-4 bg-surface border-l-4 border-l-ink border border-line rounded-xl text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-ink animate-pulse" />
                                <span className="font-bold text-base text-ink tracking-tight">
                                  Confirm Desk Position on Phone
                                </span>
                              </div>
                              <p className="text-sm text-ink-muted leading-relaxed">
                                On your phone screen, tap <span className="font-bold text-ink bg-paper px-2 py-0.5 rounded border border-line">&quot;I am in position — Start Monitoring&quot;</span>. This laptop console will unlock automatically once confirmed.
                              </p>
                            </div>
                            <div className="shrink-0 flex items-center gap-2 bg-paper border border-line px-3 py-1.5 rounded-lg font-mono text-xs text-ink font-semibold">
                              <span className="w-2 h-2 rounded-full bg-ink animate-ping" />
                              <span>Awaiting confirmation</span>
                            </div>
                          </div>
                        )}

                        {/* Phone Successfully Active: Confirmation banner */}
                        {mobileActive && (
                          <div className="p-3.5 bg-green/10 border border-green/30 rounded-xl text-sm text-green flex items-center justify-between">
                            <span className="font-bold">Secondary phone monitoring confirmed. Desk view active.</span>
                            <span className="text-xs font-mono bg-green/20 px-2.5 py-1 rounded text-green font-bold">
                              Confirmed
                            </span>
                          </div>
                        )}

                        {!mobileActive && pairingUrl && (
                          <div className="pt-3 border-t border-line space-y-3.5 bg-surface p-4 rounded-xl">
                            <div className="flex flex-col sm:flex-row items-center gap-5">
                              <div className="p-2.5 bg-white rounded-xl border border-line shadow-xs shrink-0">
                                <QRCodeDisplay value={pairingUrl} size={125} />
                              </div>
                              <div className="space-y-2.5 text-sm text-ink-muted text-left">
                                <div className="font-bold text-ink text-base">Follow these steps on your phone:</div>
                                <ol className="list-decimal list-inside space-y-2 text-ink-muted text-sm leading-relaxed">
                                  <li>
                                    <strong className="text-ink font-semibold">Scan the QR code:</strong> Open your smartphone camera and scan the code.
                                  </li>
                                  <li>
                                    <strong className="text-ink font-semibold">Open companion link:</strong> Tap the prompt to open the proctor screen in your phone browser.
                                  </li>
                                  <li>
                                    <strong className="text-ink font-semibold">Prop on desk at 45°:</strong> Place your phone 2–3 feet to your side facing your hands and keyboard (see setup video above).
                                  </li>
                                  <li>
                                    <strong className="text-ink font-semibold">Tap &quot;Start Monitoring&quot;:</strong> Press the button on your phone. This laptop screen will confirm and unlock.
                                  </li>
                                </ol>
                              </div>
                            </div>

                            {/* Tunnel Host override for localhost testing */}
                            {typeof window !== "undefined" &&
                              (window.location.hostname === "localhost" ||
                                window.location.hostname === "127.0.0.1") && (
                                <div className="pt-3 border-t border-line text-xs sm:text-sm space-y-2 bg-paper p-3 rounded-lg">
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs sm:text-sm font-bold text-ink">
                                      Testing on mobile phone?
                                    </label>
                                    <span className="text-xs text-ink-muted font-mono">Set HTTPS Tunnel URL</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      placeholder="https://boys-housewares-findlaw-prove.trycloudflare.com"
                                      value={customHost}
                                      onChange={(e) => {
                                        const h = e.target.value.trim().replace(/\/$/, "");
                                        setCustomHost(h);
                                        if (pairingToken) {
                                          const base = h || window.location.origin;
                                          setPairingUrl(`${base}/proctor?token=${encodeURIComponent(pairingToken)}`);
                                        }
                                      }}
                                      className="flex-1 px-3 py-1.5 text-xs sm:text-sm border border-line rounded-lg bg-surface text-ink font-mono focus:outline-none focus:border-pen"
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        const cloudflareUrl = "https://boys-housewares-findlaw-prove.trycloudflare.com";
                                        setCustomHost(cloudflareUrl);
                                        if (pairingToken) {
                                          setPairingUrl(`${cloudflareUrl}/proctor?token=${encodeURIComponent(pairingToken)}`);
                                        }
                                      }}
                                      className="text-xs sm:text-sm py-1.5 px-3 shrink-0 font-medium"
                                    >
                                      Use Cloudflare URL
                                    </Button>
                                  </div>
                                </div>
                              )}
                          </div>
                        )}

                        {mobileConnected && (
                          <div className="pt-2.5 border-t border-line flex items-center justify-between text-sm text-ink-muted bg-surface p-3 rounded-xl">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-green animate-pulse" />
                              <span className="text-ink font-bold">Side camera linked</span>
                              {mobilePhoneState?.battery !== null && mobilePhoneState?.battery !== undefined && (
                                <span className="text-ink-muted font-mono">• Battery {mobilePhoneState.battery}%</span>
                              )}
                            </div>
                            <span className="text-xs sm:text-sm text-green font-bold">Desk view verified</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>

                {/* Agreement & Launch Card */}
                <Card className="lg:col-span-5 space-y-6 p-6 sm:p-7">
                  <div className="space-y-1.5">
                    <h3 className="font-display font-bold text-xl sm:text-2xl text-ink">
                      Ready to start
                    </h3>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Starting the test will open fullscreen mode and start your test timer immediately.
                    </p>
                  </div>

                  {screensStatus === "prompt" && (
                    <Notice className="space-y-2.5 text-sm">
                      <p className="font-bold text-ink">
                        Display check needed
                      </p>
                      <p className="leading-relaxed">
                        Chrome needs permission to verify that only one display is connected.
                      </p>
                      <Button
                        size="md"
                        className="w-full text-sm font-semibold"
                        onClick={() => checkScreenConfiguration(true)}
                        loading={isRequestingScreen}
                      >
                        Verify display
                      </Button>
                    </Notice>
                  )}

                  {screensStatus === "multiple" && (
                    <Notice variant="error" className="space-y-2 text-sm">
                      <p className="font-bold text-red">
                        Extra screens connected ({screenCount} displays)
                      </p>
                      <p className="text-sm leading-relaxed">
                        External displays are not allowed during the test. Please disconnect other monitors to continue.
                      </p>
                    </Notice>
                  )}

                  <label className="flex items-start gap-3.5 p-4 rounded-xl border border-line bg-paper cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rulesAccepted}
                      onChange={(e) => setRulesAccepted(e.target.checked)}
                      disabled={!allChecksPassed || countdown !== null}
                      className="w-5 h-5 rounded border-line text-pen mt-0.5 cursor-pointer accent-pen shrink-0"
                    />
                    <span className="text-sm sm:text-base text-ink leading-relaxed font-medium">
                      I agree to the test rules and understand that leaving the test window will log warnings.
                    </span>
                  </label>

                  {countdown !== null ? (
                    <div className="p-6 rounded-xl bg-surface border border-line text-center space-y-2">
                      <div className="font-extrabold text-4xl sm:text-5xl tabular-nums text-ink">
                        {countdown}
                      </div>
                      <div className="text-sm text-ink-muted font-medium">
                        Starting your test session...
                      </div>
                    </div>
                  ) : screensStatus === "prompt" ? (
                    <Button
                      size="lg"
                      className="w-full text-base font-bold py-3.5"
                      onClick={() => checkScreenConfiguration(true)}
                      loading={isRequestingScreen}
                    >
                      Verify display to continue
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      {requiresMobileMonitoring && mobilePaired && !mobileActive && (
                        <div className="p-3.5 bg-surface border border-line rounded-xl text-sm text-ink shadow-xs flex items-center gap-3 text-left">
                          <span className="w-2.5 h-2.5 rounded-full bg-ink animate-pulse shrink-0" />
                          <div className="leading-snug">
                            <span className="font-bold block text-sm sm:text-base text-ink">Action Required on Phone</span>
                            <span className="text-xs sm:text-sm text-ink-muted">Press &quot;I am in position — Start Monitoring&quot; on your phone screen to unlock the test.</span>
                          </div>
                        </div>
                      )}
                      <Button
                        size="lg"
                        className="w-full text-base sm:text-lg font-bold py-4"
                        disabled={!canStart}
                        onClick={handleStartClick}
                      >
                        {canStart
                          ? "Start test"
                          : requiresMobileMonitoring && mobilePaired && !mobileActive
                          ? "Tap 'Start Monitoring' on Phone"
                          : requiresMobileMonitoring && !mobilePaired
                          ? "Scan QR & Connect Phone to Start"
                          : !allChecksPassed
                          ? "Complete checks above to start"
                          : "Accept rules above to start"}
                      </Button>
                    </div>
                  )}

                  {!allChecksPassed && (
                    <p className="text-center text-sm text-ink-muted leading-relaxed">
                      {screensStatus === "prompt"
                        ? "Verify your display to continue."
                        : requiresMobileMonitoring && mobilePaired && !mobileActive
                        ? "Waiting for confirmation from your phone screen..."
                        : requiresMobileMonitoring && !mobilePaired
                        ? "Connect your smartphone camera to unlock test."
                        : "All system checks must pass before the test unlocks."}
                    </p>
                  )}
                </Card>
              </div>
            </div>
          )}
        </main>

        {/* Direct Screen Verification Modal */}
        {showVerifyModal && screensStatus === "prompt" && (
          <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4">
            <Card className="max-w-md w-full space-y-4">
              <div className="space-y-1">
                <h2 className="font-semibold text-lg text-ink">
                  Single display verification
                </h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Tests must be taken on a single screen. Allow permission when prompted so the platform can verify your monitor setup.
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <Button
                  size="md"
                  className="w-full text-sm"
                  onClick={() => checkScreenConfiguration(true)}
                  loading={isRequestingScreen}
                >
                  Allow and verify display
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowVerifyModal(false)}
                  className="w-full text-xs text-ink-muted"
                >
                  Cancel
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </StudentGuard>
  );
}
