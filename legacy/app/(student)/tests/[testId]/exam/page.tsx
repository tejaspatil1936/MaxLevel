"use client";

import React, { useEffect, useState, useRef, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Badge } from "@/components/ui/Badge";
import { apiClient } from "@/lib/apiClient";
import { useProctor } from "@/hooks/useProctor";
import { useExamTimer } from "@/hooks/useExamTimer";
import { useFaceMonitor } from "@/hooks/useFaceMonitor";
import { Question, StartTestResponse, SubmitReason } from "@/types";

export default function ExamRunnerPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  const { testId } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  // Lifecycle states: loading | running | submitted | auto_submitted
  const [examStatus, setExamStatus] = useState<
    "loading" | "running" | "submitted" | "auto_submitted" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoSubmitReason, setAutoSubmitReason] = useState<string>("");
  const [autoSubmitDetail, setAutoSubmitDetail] = useState<string>("");
  const [strikeToast, setStrikeToast] = useState<{
    strike: number;
    max: number;
    message: string;
  } | null>(null);

  // Attempt & Test session data
  const [attemptId, setAttemptId] = useState<string>("");
  const [testDay, setTestDay] = useState<number | null>(null);
  const [testTitle, setTestTitle] = useState<string>("");
  const [testCompany, setTestCompany] = useState<string>("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [deadlineAt, setDeadlineAt] = useState<string>("");
  const [serverNow, setServerNow] = useState<string>("");

  // Navigation & Answers
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});

  // Confirm submit modal
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Camera Disconnection & Screen Veil State
  const [isCameraVeiled, setIsCameraVeiled] = useState(false);
  const [cameraRecoverySeconds, setCameraRecoverySeconds] = useState(60);
  const [cameraDisconnectCount, setCameraDisconnectCount] = useState(0);
  const [isReconnectingCamera, setIsReconnectingCamera] = useState(false);

  // Desktop width check (≥ 1024px)
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Answers getter for proctor / autosave
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const getCurrentAnswers = useCallback(() => answersRef.current, []);

  // Auto-submit callback
  const handleAutoSubmit = useCallback((reason: string, detail?: string) => {
    if (typeof window !== "undefined" && attemptId) {
      window.sessionStorage.removeItem(`exam_answers_${attemptId}`);
    }
    setAutoSubmitReason(reason);
    setAutoSubmitDetail(detail || "");
    setExamStatus("auto_submitted");
  }, [attemptId]);

  // Proctor Hook
  const {
    strikes,
    maxStrikes,
    warningMessage,
    dismissWarning,
    isFullscreen,
    requestFullscreen,
    reportViolation,
  } = useProctor({
    attemptId,
    isActive: examStatus === "running",
    onAutoSubmit: handleAutoSubmit,
    onStrikeRecorded: (strike, max, message) => {
      setStrikeToast({ strike, max, message });
      setTimeout(() => {
        setStrikeToast((prev) => (prev?.strike === strike ? null : prev));
      }, 7000);
    },
    getCurrentAnswers,
  });

  // Camera Proctor Hook
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  // Secondary Mobile Proctor (On-Device Vision Checks)
  const [phonePaired, setPhonePaired] = useState(false);
  const [phoneStrikes, setPhoneStrikes] = useState(0);
  const [phoneActive, setPhoneActive] = useState(true);
  const [phonePausedUntil, setPhonePausedUntil] = useState<number | null>(null);
  const [phonePauseUsed, setPhonePauseUsed] = useState(false);
  const [phoneBanner, setPhoneBanner] = useState<string | null>(null);
  const [isPausingPhone, setIsPausingPhone] = useState(false);
  const lastSeenPhoneEventTimeRef = useRef<number>(Date.now());

  const handleFaceViolation = useCallback(
    (
      type: "camera_no_face" | "camera_multiple_faces" | "camera_lost" | "camera_phone_detected",
      message: string
    ) => {
      if (type === "camera_lost") {
        setIsCameraVeiled(true);
        return;
      }
      reportViolation(type, message);
    },
    [reportViolation]
  );

  const {
    monitorStatus,
    faceCount,
    requestCamera,
    switchCamera,
    refreshDevices,
    videoDevices,
    selectedDeviceId,
  } = useFaceMonitor({
    isActive: examStatus === "running",
    videoRef: cameraVideoRef,
    onViolation: handleFaceViolation,
  });

  useEffect(() => {
    if (examStatus === "running") {
      requestCamera();
    }
  }, [examStatus, requestCamera]);

  // Final submit handler with automatic retries on network failures
  const performSubmit = useCallback(
    async (reason: SubmitReason = "manual", retryCount = 0) => {
      if (!attemptId) return;
      if (submitting && retryCount === 0) return;
      if (reason === "terminated_by_proctor") {
        setAutoSubmitReason("terminated_by_proctor");
        setAutoSubmitDetail("Secondary phone proctor quota exceeded (5 of 5 strikes).");
      }
      setSubmitting(true);
      try {
        await apiClient.post(`/api/attempts/${attemptId}/submit`, {
          answers: answersRef.current,
          reason,
        });
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(`exam_answers_${attemptId}`);
        }
        if (reason && reason !== "manual") {
          setAutoSubmitReason(reason);
          setExamStatus("auto_submitted");
        } else {
          setExamStatus("submitted");
        }
        setSubmitting(false);
        setShowSubmitConfirm(false);
      } catch (err: any) {
        // If already submitted, conclude gracefully
        if (err?.message?.includes("already")) {
          if (reason && reason !== "manual") {
            setAutoSubmitReason(reason);
            setExamStatus("auto_submitted");
          } else {
            setExamStatus("submitted");
          }
          setSubmitting(false);
          setShowSubmitConfirm(false);
        } else if (retryCount < 5) {
          // Retry submit up to 5 times (accepts submissions up to deadlineAt + 30s)
          setTimeout(() => {
            performSubmit(reason, retryCount + 1);
          }, 1500 * (retryCount + 1));
        } else {
          setSubmitting(false);
          setShowSubmitConfirm(false);
          alert(err?.message || "Failed to submit. Please check your network and retry.");
        }
      }
    },
    [attemptId, submitting]
  );

  // Periodic Heartbeat & Status Watcher for Secondary Phone Proctor (No WebRTC)
  useEffect(() => {
    if (!attemptId || examStatus !== "running") return;
    let isDisposed = false;

    const phoneMessages: Record<string, string> = {
      NO_FACE: "Your face is not visible on the phone camera. Sit in frame.",
      MULTI_FACE: "Multiple people detected on the phone camera. Please remain alone.",
      PHONE_OBJECT: "Phone or unauthorized device detected on camera.",
      BOOK_OBJECT: "Book or notes detected in phone camera view.",
      LOOK_AWAY: "Frequent looking away detected. Focus on your screen.",
      CAMERA_BLOCKED: "Secondary phone camera appears blocked or obstructed.",
      DEVICE_MOVED: "Secondary phone moved. Keep the device still.",
      PAGE_HIDDEN: "Secondary phone page left the foreground.",
      HEARTBEAT_LOST: "Phone connection lost. Ensure the proctoring screen is active.",
    };

    const checkPhoneHeartbeat = async () => {
      try {
        const res = await apiClient.post<{
          ok: boolean;
          paired: boolean;
          active?: boolean;
          strikes: number;
          phoneActive: boolean;
          pausedUntil: number | null;
          status: string;
          lastEvent?: { type: string; t: number; weight: number } | null;
          recentEvents?: Array<{ type: string; t: number; meta?: any }>;
        }>("/api/proctor/heartbeat", { attemptId });

        if (isDisposed) return;
        if (res.paired) {
          setPhonePaired(true);
        }
        setPhoneActive(Boolean(res.phoneActive || res.active));
        if (res.pausedUntil) {
          setPhonePausedUntil(res.pausedUntil);
          setPhonePauseUsed(true);
        }

        // Show instant alert banner on new events
        if (Array.isArray(res.recentEvents) && res.recentEvents.length > 0) {
          const latest = res.recentEvents[res.recentEvents.length - 1];
          if (latest && latest.t > lastSeenPhoneEventTimeRef.current) {
            lastSeenPhoneEventTimeRef.current = latest.t;
            const msg = phoneMessages[latest.type] || "Phone security check noted.";
            const count = typeof res.strikes === "number" ? res.strikes : phoneStrikes;
            setPhoneBanner(`${msg} (Phone checks ${count} of 5 used)`);
          }
        } else if (res.lastEvent && res.lastEvent.t > lastSeenPhoneEventTimeRef.current) {
          lastSeenPhoneEventTimeRef.current = res.lastEvent.t;
          const msg = phoneMessages[res.lastEvent.type] || "Phone security check noted.";
          setPhoneBanner(`${msg} (Phone checks ${res.strikes} of 5 used)`);
        } else if (typeof res.strikes === "number" && res.strikes > phoneStrikes) {
          setPhoneBanner(`Phone checks ${res.strikes} of 5 used.`);
        }

        if (typeof res.strikes === "number") {
          setPhoneStrikes(res.strikes);
        }

        // Auto-terminate if quota reached or proctor terminated
        if (res.status === "terminated_by_proctor" || (typeof res.strikes === "number" && res.strikes >= 5)) {
          performSubmit("terminated_by_proctor");
        }
      } catch {}
    };

    checkPhoneHeartbeat();
    const interval = setInterval(checkPhoneHeartbeat, 1500);

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [attemptId, examStatus, phoneStrikes, performSubmit]);

  // Clear banner after 6s
  useEffect(() => {
    if (!phoneBanner) return;
    const t = setTimeout(() => setPhoneBanner(null), 6000);
    return () => clearTimeout(t);
  }, [phoneBanner]);

  // Emergency 2-Minute Pause for Phone Calls or Repositioning
  const handleEmergencyPausePhone = async () => {
    if (!attemptId || phonePauseUsed || isPausingPhone) return;
    setIsPausingPhone(true);
    try {
      const res = await apiClient.post<{ ok: boolean; pausedUntil: number }>("/api/proctor/pause", {
        attemptId,
      });
      if (res.ok) {
        setPhonePausedUntil(res.pausedUntil);
        setPhonePauseUsed(true);
        setPhoneBanner("Secondary phone proctor paused for 2 minutes.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to pause phone proctor");
    } finally {
      setIsPausingPhone(false);
    }
  };

  // Timeout callback
  const handleTimeout = useCallback(() => {
    performSubmit("timeout");
  }, [performSubmit]);

  // Trigger camera recovery veil when camera stream is lost
  useEffect(() => {
    if (examStatus !== "running") {
      setIsCameraVeiled(false);
      return;
    }

    if (monitorStatus === "camera_lost") {
      setIsCameraVeiled((prev) => {
        if (!prev) {
          setCameraDisconnectCount((c) => {
            const nextCount = c + 1;
            if (nextCount > 2) {
              reportViolation(
                "camera_lost",
                `Excessive camera interruptions detected (${nextCount} occurrences). Please maintain continuous webcam feed.`
              );
            }
            return nextCount;
          });
          setCameraRecoverySeconds(60);
        }
        return true;
      });
    } else if (monitorStatus === "ready" || monitorStatus === "no_face" || monitorStatus === "multiple_faces") {
      setIsCameraVeiled(false);
      setCameraRecoverySeconds(60);
    }
  }, [monitorStatus, examStatus, reportViolation]);

  // 60-second recovery countdown while camera is veiled
  useEffect(() => {
    if (!isCameraVeiled || examStatus !== "running") return;

    const interval = setInterval(() => {
      setCameraRecoverySeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setAutoSubmitReason("camera");
          setAutoSubmitDetail(
            "Assessment auto-submitted: Camera was disconnected for more than 60 seconds without reconnection."
          );
          performSubmit("camera");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isCameraVeiled, examStatus, performSubmit]);

  const handleManualCameraReconnect = async (overrideDeviceId?: string) => {
    setIsReconnectingCamera(true);
    try {
      const devId = overrideDeviceId || selectedDeviceId || undefined;
      const ok = await requestCamera(devId);
      if (ok) {
        setIsCameraVeiled(false);
        setCameraRecoverySeconds(60);
      }
    } finally {
      setIsReconnectingCamera(false);
    }
  };

  const handleCameraDeviceChange = async (newDeviceId: string) => {
    setIsReconnectingCamera(true);
    try {
      const ok = await switchCamera(newDeviceId);
      if (ok) {
        setIsCameraVeiled(false);
        setCameraRecoverySeconds(60);
      }
    } finally {
      setIsReconnectingCamera(false);
    }
  };

  const handleDismissWarning = async () => {
    dismissWarning();
    if (monitorStatus === "camera_lost" || monitorStatus === "no_face") {
      await requestCamera(selectedDeviceId || undefined);
    }
  };

  // Exam Timer Hook
  const { formatted: timerFormatted, timerStatus } = useExamTimer({
    deadlineAt,
    serverNow,
    onTimeout: handleTimeout,
    isActive: examStatus === "running" && !!deadlineAt,
  });

  // Start attempt on mount
  useEffect(() => {
    let isMounted = true;

    const initExam = async () => {
      try {
        let startMeta: any = undefined;
        if (typeof window !== "undefined") {
          const cachedScreens = window.sessionStorage.getItem("exam_multi_screen");
          if (cachedScreens) {
            try {
              startMeta = JSON.parse(cachedScreens);
            } catch {}
          }
        }

        const startRes = await apiClient.post<StartTestResponse>(
          `/api/tests/${testId}/start`,
          { meta: startMeta }
        );

        if (!isMounted) return;

        setAttemptId(startRes.attemptId);
        setTestDay(startRes.day ?? null);
        setTestTitle(startRes.testTitle || "");
        setTestCompany(startRes.company || "");
        setQuestions(startRes.questions || []);
        setDeadlineAt(startRes.deadlineAt);
        setServerNow(startRes.serverNow);

        // If this is a reconnect to an ongoing attempt, restore answers from server + sessionStorage.
        // If this is a brand new (or admin-reset) attempt, start completely blank and purge old storage.
        let restoredAnswers: Record<string, number> = {};
        if (startRes.isReconnect) {
          restoredAnswers = {
            ...(startRes.answers || {}),
          };
          if (typeof window !== "undefined") {
            const cached = window.sessionStorage.getItem(
              `exam_answers_${startRes.attemptId}`
            );
            if (cached) {
              try {
                restoredAnswers = {
                  ...restoredAnswers,
                  ...JSON.parse(cached),
                };
              } catch {
                // Ignore corrupted storage
              }
            }
          }
        } else {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(
              `exam_answers_${startRes.attemptId}`
            );
          }
          restoredAnswers = {};
        }
        setAnswers(restoredAnswers);

        setExamStatus("running");
      } catch (err: any) {
        if (!isMounted) return;
        setErrorMessage(
          err?.message || "Failed to initialize assessment session."
        );
        setExamStatus("error");
      }
    };

    initExam();

    return () => {
      isMounted = false;
    };
  }, [testId]);

  // Periodic autosave (every 2 minutes) with dirty-check & retry on failure
  useEffect(() => {
    if (examStatus !== "running" || !attemptId) return;

    let pendingAutosaveAnswers: Record<string, number> | null = null;
    let lastSavedJson = JSON.stringify(answersRef.current);

    const saveAnswers = async (currentAnswers: Record<string, number>) => {
      try {
        await apiClient.put(`/api/attempts/${attemptId}/answers`, {
          answers: currentAnswers,
        });
        lastSavedJson = JSON.stringify(currentAnswers);
        pendingAutosaveAnswers = null;
      } catch {
        // Queue for retry
        pendingAutosaveAnswers = currentAnswers;
      }
    };

    const autosaveInterval = setInterval(() => {
      const current = answersRef.current;
      const currentJson = JSON.stringify(current);

      // Only perform network request and Firestore write if answers have changed or retry is pending
      if (pendingAutosaveAnswers) {
        saveAnswers(pendingAutosaveAnswers);
      } else if (currentJson !== lastSavedJson) {
        saveAnswers(current);
      }
    }, 2 * 60 * 1000);

    const handleOnline = () => {
      if (pendingAutosaveAnswers) {
        saveAnswers(pendingAutosaveAnswers);
      }
    };
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(autosaveInterval);
      window.removeEventListener("online", handleOnline);
    };
  }, [examStatus, attemptId]);

  // Option selection (clicking the selected option toggles it off)
  const handleSelectOption = (optionIndex: number) => {
    const currentQ = questions[currentIndex];
    if (!currentQ || examStatus !== "running") return;

    const currentSelected = answers[currentQ.id];
    const updated = { ...answers };
    if (currentSelected === optionIndex) {
      delete updated[currentQ.id];
    } else {
      updated[currentQ.id] = optionIndex;
    }
    setAnswers(updated);

    // Mirror to sessionStorage
    if (typeof window !== "undefined" && attemptId) {
      window.sessionStorage.setItem(
        `exam_answers_${attemptId}`,
        JSON.stringify(updated)
      );
    }
  };

  // Clear current question response
  const handleClearOption = () => {
    const currentQ = questions[currentIndex];
    if (!currentQ || examStatus !== "running") return;

    const updated = { ...answers };
    delete updated[currentQ.id];
    setAnswers(updated);

    if (typeof window !== "undefined" && attemptId) {
      window.sessionStorage.setItem(
        `exam_answers_${attemptId}`,
        JSON.stringify(updated)
      );
    }
  };

  // Toggle mark for review
  const handleToggleReview = () => {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;
    setMarkedForReview((prev) => ({
      ...prev,
      [currentQ.id]: !prev[currentQ.id],
    }));
  };

  // Keyboard navigation & option selection
  useEffect(() => {
    if (examStatus !== "running" || warningMessage || !isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 1 to 4 select options
      if (e.key === "1") handleSelectOption(0);
      else if (e.key === "2") handleSelectOption(1);
      else if (e.key === "3") handleSelectOption(2);
      else if (e.key === "4") handleSelectOption(3);
      // Arrow keys navigate
      else if (e.key === "ArrowLeft") {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
      } else if (e.key.toLowerCase() === "m") {
        handleToggleReview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [examStatus, questions, currentIndex, answers, warningMessage, isFullscreen]);

  // Desktop Screen Gate
  if (!isDesktop) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6 text-center">
        <Card className="max-w-md w-full p-8 space-y-3 text-left">
          <h1 className="text-lg font-semibold text-ink">
            Desktop screen required
          </h1>
          <p className="text-sm text-ink-muted leading-relaxed">
            This test requires a desktop or laptop browser with a screen width of at least 1024px. Please maximize your window or open the test on a computer.
          </p>
        </Card>
      </div>
    );
  }

  const totalQuestions = questions.length;
  const answeredCount = Object.keys(answers).length;

  function formatAutoSubmitReason(
    reason: string,
    detail?: string
  ): { title: string; explanation: string } {
    if (detail && detail.trim().length > 0) {
      return {
        title: detail,
        explanation: "All answers chosen up to this point have been securely recorded.",
      };
    }

    switch (reason) {
      case "camera":
        return {
          title: "Camera was disconnected or multiple persons were detected in view.",
          explanation: "All answers chosen up to this point have been securely recorded.",
        };
      case "devtools":
        return {
          title: "Developer tools shortcut or inspection window was opened.",
          explanation: "All answers chosen up to this point have been securely recorded.",
        };
      case "strikes":
        return {
          title: "Maximum allowed proctoring strikes (3 of 3) were exceeded.",
          explanation: "All answers chosen up to this point have been securely recorded.",
        };
      case "timeout":
        return {
          title: "The allotted examination time limit has ended.",
          explanation: "All answers chosen up to this point have been safely saved.",
        };
      case "terminated_by_proctor":
        return {
          title: "Secondary phone proctor quota (5 strikes) was exceeded.",
          explanation: "Your assessment was automatically submitted and your answers have been securely recorded.",
        };
      default:
        return {
          title: reason || "Automated proctoring security limits were exceeded.",
          explanation: "All answers chosen up to this point have been securely recorded.",
        };
    }
  }

  // Submitted Screen (Voluntary Manual Submission)
  if (examStatus === "submitted") {
    const cleanAudit = strikes === 0 && phoneStrikes === 0;

    return (
      <div className="min-h-screen bg-paper flex flex-col justify-between selection:bg-pen/10 select-none">
        {/* Institutional Minimal Header */}
        <header className="border-b border-line bg-surface">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base text-ink">
                MITAOE Prep
              </span>
              <span className="text-xs text-ink-muted">/ Examination System</span>
            </div>
            <span className="text-xs font-semibold text-green flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green" />
              Submission Recorded
            </span>
          </div>
        </header>

        {/* Central Official Docket */}
        <main className="flex-1 max-w-xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
          <div className="border border-line rounded-lg bg-surface p-6 sm:p-8 space-y-6 shadow-xs">
            {/* Title Block */}
            <div className="space-y-1.5 pb-4 border-b border-line">
              <div className="text-xs font-mono text-ink-muted">
                Official Examination Receipt
              </div>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink">
                Assessment Submitted Successfully
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted">
                Your examination responses have been locked and submitted for official scoring.
              </p>
            </div>

            {/* Examination Receipt Summary */}
            <div className="border border-line rounded-lg divide-y divide-line text-xs bg-paper">
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Candidate</span>
                <span className="font-medium text-ink">
                  {user?.name || "Student"} {user?.prn ? `• ${user.prn}` : ""}
                </span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Answers Saved</span>
                <span className="font-semibold text-ink tabular-nums">
                  {answeredCount} of {totalQuestions || 30} questions recorded
                </span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Webcam Integrity</span>
                <span className="font-medium text-ink tabular-nums">
                  {strikes} of {maxStrikes} strikes recorded
                </span>
              </div>
              {phonePaired && (
                <div className="p-3 flex justify-between items-center">
                  <span className="text-ink-muted">Desk Phone Proctor</span>
                  <span className="font-medium text-ink tabular-nums">
                    {phoneStrikes} of 5 strikes recorded
                  </span>
                </div>
              )}
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Final Status</span>
                <span className={`font-semibold ${cleanAudit ? "text-green" : "text-ink"}`}>
                  {cleanAudit ? "Submitted & Verified (Clean Audit)" : `Submitted with ${strikes + phoneStrikes} warning(s)`}
                </span>
              </div>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              Solutions and detailed explanations will unlock on your dashboard after the test window closes (e.g. after 11:00 PM).
            </p>

            <Link href="/dashboard" className="block pt-1">
              <Button size="lg" className="w-full">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-line py-4 bg-surface text-center text-xs text-ink-muted">
          MIT Academy of Engineering • Training & Placement Examination System
        </footer>
      </div>
    );
  }

  // Auto-Submitted Screen
  if (examStatus === "auto_submitted") {
    const formattedReason = formatAutoSubmitReason(autoSubmitReason, autoSubmitDetail);
    const isTimeout = autoSubmitReason === "timeout";

    return (
      <div className="min-h-screen bg-paper flex flex-col justify-between selection:bg-pen/10 select-none">
        {/* Institutional Minimal Header */}
        <header className="border-b border-line bg-surface">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base text-ink">
                MITAOE Prep
              </span>
              <span className="text-xs text-ink-muted">/ Examination System</span>
            </div>
            <span className={`text-xs font-semibold ${isTimeout ? "text-ink-muted" : "text-red"}`}>
              {isTimeout ? "Time Expired" : "Session Closed"}
            </span>
          </div>
        </header>

        {/* Central Official Docket */}
        <main className="flex-1 max-w-xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
          <div className="border border-line rounded-lg bg-surface p-6 sm:p-8 space-y-6 shadow-xs">
            {/* Title Block */}
            <div className="space-y-1.5 pb-4 border-b border-line">
              <div className={`text-xs font-semibold ${isTimeout ? "text-ink-muted" : "text-red"}`}>
                {isTimeout ? "Scheduled Limit Reached" : "Automated Proctoring Action"}
              </div>
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink">
                {isTimeout ? "Examination Time Limit Concluded" : "Test Submitted Automatically"}
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted">
                {isTimeout
                  ? "The allotted time limit for this examination session has ended."
                  : "Your examination session was concluded by the automated proctoring monitor."}
              </p>
            </div>

            {/* Violation Callout */}
            <div className={`border-l-4 ${isTimeout ? "border-ink-muted bg-paper" : "border-red bg-paper"} p-4 rounded-r-lg space-y-1`}>
              <div className={`text-xs font-semibold ${isTimeout ? "text-ink-muted" : "text-red"}`}>
                {isTimeout ? "Submission Event" : "Reason for Termination"}
              </div>
              <p className="text-sm font-semibold text-ink">
                {formattedReason.title}
              </p>
            </div>

            {/* Examination Receipt Summary */}
            <div className="border border-line rounded-lg divide-y divide-line text-xs bg-paper">
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Candidate</span>
                <span className="font-medium text-ink">
                  {user?.name || "Student"} {user?.prn ? `• ${user.prn}` : ""}
                </span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Answers Saved</span>
                <span className="font-semibold text-ink tabular-nums">
                  {answeredCount} of {totalQuestions || 30} questions recorded
                </span>
              </div>
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Webcam Strikes</span>
                <span className="font-medium text-ink tabular-nums">
                  {strikes} of {maxStrikes} strikes recorded
                </span>
              </div>
              {phonePaired && (
                <div className="p-3 flex justify-between items-center">
                  <span className="text-ink-muted">Desk Phone Strikes</span>
                  <span className="font-medium text-ink tabular-nums">
                    {phoneStrikes} of 5 strikes recorded
                  </span>
                </div>
              )}
              <div className="p-3 flex justify-between items-center">
                <span className="text-ink-muted">Final Status</span>
                <span className={`font-semibold ${isTimeout ? "text-ink" : "text-red"}`}>
                  {isTimeout ? "Auto-Submitted on Time Limit" : "Submitted with Proctor Flag"}
                </span>
              </div>
            </div>

            <p className="text-xs text-ink-muted leading-relaxed">
              All responses recorded prior to this event have been locked and submitted for official scoring. You cannot re-enter this test session.
            </p>

            <Link href="/dashboard" className="block pt-1">
              <Button size="lg" className="w-full">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-line py-4 bg-surface text-center text-xs text-ink-muted">
          MIT Academy of Engineering • Training & Placement Examination System
        </footer>
      </div>
    );
  }

  // Loading or Error Screen
  if (examStatus === "loading") {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <span className="w-4 h-4 rounded-full border-2 border-pen border-t-transparent animate-spin" />
          <span className="text-sm text-ink-muted">
            Opening test environment...
          </span>
        </div>
      </div>
    );
  }

  if (examStatus === "error") {
    const isAlreadySubmitted =
      errorMessage?.toLowerCase().includes("already") ||
      errorMessage?.toLowerCase().includes("submitted") ||
      errorMessage?.toLowerCase().includes("completed");

    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6 select-none">
        <div className="max-w-md w-full border border-line rounded-lg bg-surface p-6 sm:p-8 space-y-5 shadow-xs text-left">
          <div className="space-y-1.5 pb-4 border-b border-line">
            <div className="text-xs font-semibold text-ink-muted">
              {isAlreadySubmitted ? "Session Concluded" : "Access Blocked"}
            </div>
            <h1 className="font-display font-extrabold text-xl text-ink">
              {isAlreadySubmitted ? "Assessment Already Submitted" : "Unable to Open Assessment"}
            </h1>
            <p className="text-xs text-ink-muted leading-relaxed">
              {isAlreadySubmitted
                ? "This test attempt has already been submitted and officially recorded in the examination ledger. Single attempt policy is strictly enforced."
                : errorMessage || "You may have already completed your attempt or the test window has closed."}
            </p>
          </div>

          <div className="border border-line rounded-lg divide-y divide-line text-xs bg-paper">
            <div className="p-3 flex justify-between items-center">
              <span className="text-ink-muted">Candidate</span>
              <span className="font-medium text-ink">
                {user?.name || "Student"} {user?.prn ? `• ${user.prn}` : ""}
              </span>
            </div>
            <div className="p-3 flex justify-between items-center">
              <span className="text-ink-muted">Status</span>
              <span className="font-semibold text-ink">
                {isAlreadySubmitted ? "Finalized & Locked" : "Unavailable"}
              </span>
            </div>
          </div>

          <Link href="/dashboard" className="block pt-1">
            <Button size="lg" className="w-full">
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const selectedOption = currentQ ? answers[currentQ.id] : undefined;

  return (
    <StudentGuard>
      <div className="min-h-screen bg-paper flex flex-col justify-between select-none relative">
        {/* Fullscreen Required Modal */}
        {/* Fullscreen Required Modal */}
        {!isFullscreen && (
          <div className="fixed inset-0 z-50 bg-ink/75 backdrop-blur-xs flex items-center justify-center p-4 select-none">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4 text-left">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-ink">
                  Fullscreen mode required
                </h2>
                <p className="text-sm text-ink-muted leading-relaxed">
                  You left fullscreen mode. Examination rules require keeping fullscreen active throughout the test.
                </p>
              </div>
              <p className="text-xs text-ink-muted">
                Your test timer continues in the background.
              </p>
              <Button size="lg" className="w-full" onClick={requestFullscreen}>
                Return to fullscreen
              </Button>
            </Card>
          </div>
        )}

        {/* Proctor Warning Modal */}
        {warningMessage && (
          <div className="fixed inset-0 z-50 bg-ink/75 backdrop-blur-xs flex items-center justify-center p-4 select-none">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-5 text-left border-red/40 shadow-[0_0_24px_rgba(220,38,38,0.14)] relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-red" />
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <h2 className="font-display font-bold text-xl text-ink">
                    Proctor warning
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Strikes {strikes} of {maxStrikes}
                  </p>
                </div>
                <div className="flex items-center gap-1.5" title={`Strikes ${strikes} of ${maxStrikes}`}>
                  {Array.from({ length: maxStrikes }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full ${
                        i < strikes
                          ? "bg-red"
                          : "bg-line"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Notice variant="alert">
                  {warningMessage}
                </Notice>

                {/* Multiple faces guidance */}
                {/multiple face/i.test(warningMessage) && (
                  <div className="bg-paper p-3 rounded-lg border border-line text-xs text-ink-muted leading-relaxed">
                    Please make sure you are alone. Only the candidate should be visible in your camera frame.
                  </div>
                )}

                {/* Camera selector ONLY if it's genuinely a camera disconnection / device issue */}
                {videoDevices.length > 1 &&
                  (/camera disconnected|camera lost|no webcam|no camera/i.test(warningMessage) ||
                    (/not detected/i.test(warningMessage) && !/multiple face/i.test(warningMessage))) && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs text-ink-muted">
                        <span>Camera device:</span>
                        <button
                          type="button"
                          onClick={() => refreshDevices()}
                          className="text-pen hover:underline text-[11px] cursor-pointer"
                        >
                          Refresh devices
                        </button>
                      </div>
                      <select
                        value={selectedDeviceId || ""}
                        onChange={async (e) => {
                          if (e.target.value) {
                            await switchCamera(e.target.value);
                          }
                        }}
                        className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pen"
                      >
                        {videoDevices.map((d, i) => {
                          const isVirtual = /obs|virtual|manycam|snap/i.test(d.label || "");
                          return (
                            <option key={d.deviceId || i} value={d.deviceId}>
                              {d.label || `Camera ${i + 1}`} {isVirtual ? "(Virtual / OBS - Inactive)" : ""}
                            </option>
                          );
                        })}
                      </select>
                      <p className="text-[11px] text-ink-muted">
                        If your camera is pointing to OBS or an inactive webcam, choose your physical camera above.
                      </p>
                    </div>
                  )}

                <p className={`text-xs ${strikes >= maxStrikes - 1 ? "text-red font-semibold" : "text-ink-muted"}`}>
                  {strikes >= maxStrikes - 1
                    ? `Warning: Reaching ${maxStrikes} strikes will submit your test immediately.`
                    : `Reaching ${maxStrikes} strikes will submit your test automatically.`}
                </p>
              </div>

              <Button size="md" className="w-full" onClick={handleDismissWarning}>
                Resume test
              </Button>
            </Card>
          </div>
        )}

        {/* Full-Screen Camera Disconnection & Screen Veil Modal */}
        {isCameraVeiled && (
          <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-xs flex items-center justify-center p-4 select-none">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4 text-left">
              <div className="space-y-1 border-b border-line pb-3">
                <h2 className="text-lg font-semibold text-ink">
                  Webcam disconnected
                </h2>
                <p className="text-xs text-ink-muted">
                  Test paused until camera is reconnected
                </p>
              </div>

              <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
                Your webcam is required during the test. Questions are hidden until the camera stream is restored.
              </p>

              {/* Grace Countdown Box */}
              <div className="bg-paper border border-line rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>Time to reconnect:</span>
                  <span className="font-mono tabular-nums text-ink font-semibold">
                    00:{cameraRecoverySeconds.toString().padStart(2, "0")}
                  </span>
                </div>
                <div className="w-full bg-line rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-ink h-full transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(cameraRecoverySeconds / 60) * 100}%` }}
                  />
                </div>
                <p className="text-[11px] text-ink-muted">
                  The test clock continues in the background. The test submits if timer expires.
                </p>
              </div>

              {/* Camera Source Selector */}
              {videoDevices.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span>Camera source:</span>
                    <button
                      type="button"
                      onClick={() => refreshDevices()}
                      className="text-pen hover:underline text-[11px] cursor-pointer"
                    >
                      Detect cameras
                    </button>
                  </div>
                  <select
                    value={selectedDeviceId || ""}
                    onChange={(e) => handleCameraDeviceChange(e.target.value)}
                    disabled={isReconnectingCamera}
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pen"
                  >
                    {videoDevices.map((d, i) => {
                      const isVirtual = /obs|virtual|manycam|snap/i.test(d.label || "");
                      return (
                        <option key={d.deviceId || i} value={d.deviceId}>
                          {d.label || `Camera ${i + 1}`} {isVirtual ? "(Virtual / OBS - Inactive)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Reconnect Action Button */}
              <div className="space-y-2 pt-1">
                <Button
                  className="w-full"
                  onClick={() => handleManualCameraReconnect()}
                  disabled={isReconnectingCamera}
                  loading={isReconnectingCamera}
                >
                  {isReconnectingCamera ? "Checking webcam..." : "Reconnect camera"}
                </Button>
                <div className="text-xs text-ink-muted text-center">
                  Interruption {cameraDisconnectCount} of 2 allowed without penalty
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Submit Confirmation Dialog */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-6">
            <Card className="max-w-md w-full p-6 sm:p-8 space-y-4 text-left">
              <h2 className="text-lg font-semibold text-ink">
                Submit test?
              </h2>
              <div className="space-y-2 text-sm text-ink-muted">
                <p>
                  You have answered <span className="text-ink font-semibold">{answeredCount} of {totalQuestions}</span> questions.
                </p>
                {Object.values(markedForReview).filter(Boolean).length > 0 && (
                  <p className="text-xs text-ink-muted">
                    {Object.values(markedForReview).filter(Boolean).length} questions marked for review.
                  </p>
                )}
                <p className="text-xs text-ink-muted">
                  Once submitted, you cannot change your answers.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowSubmitConfirm(false)}
                  disabled={submitting}
                >
                  Return to exam
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => performSubmit("manual")}
                  loading={submitting}
                >
                  Submit test
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Strike Notification Toast */}
        {strikeToast && (
          <div className="fixed top-20 right-6 z-50 max-w-sm w-full bg-surface border border-line shadow-sm rounded-lg p-4 space-y-1" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">
                Strike {strikeToast.strike} of {strikeToast.max}
              </span>
              <button
                type="button"
                onClick={() => setStrikeToast(null)}
                className="text-ink-muted hover:text-ink text-xs cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <p className="text-xs text-ink-muted">
              {strikeToast.message}
            </p>
            {strikeToast.strike >= strikeToast.max - 1 && (
              <p className="text-[11px] text-red font-medium">
                Reaching {strikeToast.max} strikes will submit your test automatically.
              </p>
            )}
          </div>
        )}

        {/* Top Bar */}
        <header className="border-b border-line bg-surface sticky top-0 z-20 px-6 h-16 flex items-center justify-between">
          {/* Left: Test Title & Day */}
          <div className="flex items-center gap-3">
            <span className="font-semibold text-base text-ink">
              {testCompany ? `${testCompany} Placement Test` : testTitle || "MITAOE Placement Test"}
            </span>
            <Badge variant="neutral">
              Day {testDay !== null ? testDay : "—"}
            </Badge>
          </div>

          {/* Center: Dual Strike Meters (Laptop & Phone) */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">
                Laptop {strikes}/{maxStrikes}
              </span>
              <div className="flex items-center gap-1" title={`Laptop Strikes ${strikes} of ${maxStrikes}`}>
                {Array.from({ length: maxStrikes }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full ${
                      i < strikes
                        ? strikes >= maxStrikes
                          ? "bg-red"
                          : "bg-ink"
                        : "bg-line"
                    }`}
                  />
                ))}
              </div>
            </div>

            {phonePaired && (
              <div className="flex items-center gap-2 border-l border-line pl-3">
                <span className="font-semibold text-ink">
                  Phone {phoneStrikes}/5
                </span>
                <div className="flex items-center gap-1" title={`Phone Strikes ${phoneStrikes} of 5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full ${
                        i < phoneStrikes
                          ? "bg-red"
                          : "bg-line"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Camera Thumbnail & Tabular Timer */}
          <div className="flex items-center gap-3">
              {/* Live Camera Preview Thumbnail */}
              <div className="relative w-20 h-14 sm:w-24 sm:h-16 rounded-lg overflow-hidden border border-line bg-paper shrink-0" title="Front Camera">
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <span className="absolute top-1 left-1 bg-black/60 text-[9px] text-white/90 px-1 py-0.2 rounded font-sans leading-tight">
                  Face
                </span>

                {/* Status dot in bottom right */}
                <div
                  className={`absolute bottom-1 right-1 w-2 h-2 rounded-full ${
                    monitorStatus === "ready"
                      ? "bg-green"
                      : monitorStatus === "phone_detected"
                      ? "bg-red animate-ping"
                      : monitorStatus === "multiple_faces" || faceCount > 1
                      ? "bg-red"
                      : monitorStatus === "no_face"
                      ? "bg-ink"
                      : "bg-ink-muted"
                  }`}
                  title={
                    monitorStatus === "ready"
                      ? "Candidate verified"
                      : monitorStatus === "phone_detected"
                      ? "Unauthorized phone detected"
                      : monitorStatus === "multiple_faces" || faceCount > 1
                      ? "Multiple faces detected"
                      : monitorStatus === "no_face"
                      ? "Face not detected"
                      : "Camera active"
                  }
                />
              </div>

              {/* Secondary Phone Proctor Status Badge & Emergency Pause */}
              {phonePaired && (
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-line bg-surface text-xs shrink-0"
                  title={
                    phonePausedUntil && Date.now() < phonePausedUntil
                      ? "Phone proctoring temporarily paused"
                      : phoneActive
                      ? "Secondary phone monitoring active"
                      : "Secondary phone disconnected or screen closed"
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        phonePausedUntil && Date.now() < phonePausedUntil
                          ? "bg-blue-400 animate-pulse"
                          : phoneActive
                          ? "bg-green"
                          : "bg-red animate-ping"
                      }`}
                    />
                    <span className="font-medium text-ink hidden sm:inline">
                      {phonePausedUntil && Date.now() < phonePausedUntil
                        ? "Phone: Paused"
                        : phoneActive
                        ? "Phone: Active"
                        : "Phone: Offline"}
                    </span>
                    <span className="text-ink-muted text-[11px] font-mono">
                      ({phoneStrikes}/5)
                    </span>
                  </div>

                  {!phonePauseUsed && (!phonePausedUntil || Date.now() >= phonePausedUntil) && (
                    <button
                      type="button"
                      onClick={handleEmergencyPausePhone}
                      disabled={isPausingPhone}
                      className="ml-1 text-[10px] text-ink bg-paper hover:bg-line border border-line px-1.5 py-0.5 rounded transition"
                      title="1-time emergency 2-minute pause for phone calls or repositioning"
                    >
                      {isPausingPhone ? "..." : "Pause (2m)"}
                    </button>
                  )}
                </div>
              )}

            {/* Camera source switcher if multiple webcams available */}
            {videoDevices.length > 1 && (
              <div className="hidden xl:flex items-center">
                <select
                  value={selectedDeviceId || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      switchCamera(e.target.value);
                    }
                  }}
                  title="Switch camera device"
                  className="bg-paper border border-line text-xs text-ink rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pen max-w-[135px] truncate cursor-pointer hover:border-pen transition-colors"
                >
                  {videoDevices.map((d, i) => {
                    const isVirtual = /obs|virtual|manycam|snap/i.test(d.label || "");
                    const name = d.label || `Cam ${i + 1}`;
                    return (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {isVirtual ? `[OBS] ${name}` : name}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted hidden md:inline">
                Time left:
              </span>
              <div
                className={`font-mono tabular-nums text-xl sm:text-2xl font-semibold px-2.5 py-1 rounded-lg border ${
                  timerStatus === "red"
                    ? "border-red text-red"
                    : "bg-surface border-line text-ink"
                }`}
              >
                {timerFormatted}
              </div>
            </div>
          </div>
        </header>

        {/* Instant Secondary Phone Warning Banner */}
        {phoneBanner && (
          <div className="bg-ink text-white border-b-2 border-red px-6 py-3 text-xs flex items-center justify-between shadow-md animate-fadeIn" role="alert">
            <div className="flex items-center gap-3">
              <span className="bg-red text-white text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded">
                Phone Proctor Alert
              </span>
              <span className="font-semibold text-white/95">{phoneBanner}</span>
            </div>
            <button
              onClick={() => setPhoneBanner(null)}
              className="text-[11px] bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded transition font-medium border border-white/20 cursor-pointer"
            >
              Acknowledge
            </button>
          </div>
        )}

        {/* Real-time Camera Notice Banners */}
        {monitorStatus === "phone_detected" && (
          <div className="bg-red text-white px-6 py-3 text-xs flex items-center justify-between shadow-md" aria-live="polite">
            <div className="flex items-center gap-2.5">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-white/20 px-2 py-0.5 rounded">
                Webcam Violation
              </span>
              <span className="font-semibold">
                Unauthorized mobile phone detected in front webcam! Proctor strike recorded.
              </span>
            </div>
          </div>
        )}
        {(monitorStatus === "multiple_faces" || faceCount > 1) && (
          <div className="border-b border-line px-6 py-2.5 bg-paper" aria-live="polite">
            <Notice variant="alert">
              Multiple faces detected ({faceCount}). Only the candidate should be in camera view.
            </Notice>
          </div>
        )}
        {monitorStatus === "no_face" && (
          <div className="border-b border-line px-6 py-2.5 bg-paper" aria-live="polite">
            <Notice variant="alert">
              Face not detected. Please keep your face clearly visible to the camera.
            </Notice>
          </div>
        )}
        {monitorStatus === "camera_lost" && (
          <div className="border-b border-line px-6 py-2.5 bg-paper" aria-live="polite">
            <Notice variant="alert">
              Camera disconnected. Test is paused until camera is restored.
            </Notice>
          </div>
        )}

        {/* Main Content Area */}
        <div
          className={`flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start transition-all duration-300 ${
            isCameraVeiled ? "filter blur-xl pointer-events-none select-none opacity-20" : ""
          }`}
        >
          {/* Question & Options Area */}
          <div className="lg:col-span-8 space-y-6">
            {currentQ ? (
              <Card className="p-6 sm:p-8 space-y-6">
                {/* Header: Question Number & Meta */}
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <span className="font-display font-bold text-2xl sm:text-3xl text-ink">
                    Question {currentIndex + 1}
                    <span className="text-ink-muted text-xl font-normal">
                      /{totalQuestions}
                    </span>
                  </span>

                  <div className="flex items-center gap-2">
                    {currentQ.topic && (
                      <Badge variant="neutral">
                        {currentQ.topic}
                      </Badge>
                    )}
                    {markedForReview[currentQ.id] && (
                      <Badge variant="neutral" dot>
                        Marked for review
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Question Text */}
                <h2 className="font-display font-semibold text-2xl sm:text-3xl text-ink leading-snug">
                  {currentQ.text}
                </h2>

                {/* Options List */}
                <div className="space-y-3 pt-2">
                  {currentQ.options.map((optText, optIdx) => {
                    const isSelected = selectedOption === optIdx;
                    const optionLetter = ["A", "B", "C", "D"][optIdx];

                    return (
                      <div
                        key={optIdx}
                        onClick={() => handleSelectOption(optIdx)}
                        className={`flex items-center gap-3.5 p-3.5 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? "border-pen bg-pen/5 text-ink font-medium"
                            : "border-line bg-surface hover:bg-paper text-ink"
                        }`}
                      >
                        {/* Option Circle */}
                        <div
                          className={`w-7 h-7 rounded-full border text-xs font-semibold flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? "bg-pen text-white border-pen"
                              : "border-line bg-surface text-ink-muted"
                          }`}
                        >
                          {optionLetter}
                        </div>

                        {/* Option Text */}
                        <span className="font-sans text-base sm:text-lg flex-1">
                          {optText}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : (
              <Card className="p-12 text-center text-ink-muted">
                No question available.
              </Card>
            )}

            {/* Bottom Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleToggleReview}
                >
                  {currentQ && markedForReview[currentQ.id]
                    ? "Unmark review"
                    : "Mark for review"}
                </Button>
                {selectedOption !== undefined && (
                  <Button
                    variant="ghost"
                    onClick={handleClearOption}
                    className="text-ink-muted hover:text-ink text-xs"
                  >
                    Clear response
                  </Button>
                )}
              </div>

              <div className="flex gap-3">
                {currentIndex < totalQuestions - 1 ? (
                  <Button
                    onClick={() =>
                      setCurrentIndex((prev) =>
                        Math.min(totalQuestions - 1, prev + 1)
                      )
                    }
                  >
                    Next question
                  </Button>
                ) : (
                  <Button
                    onClick={() => setShowSubmitConfirm(true)}
                  >
                    Submit test
                  </Button>
                )}

                {currentIndex < totalQuestions - 1 && (
                  <Button
                    variant="secondary"
                    onClick={() => setShowSubmitConfirm(true)}
                  >
                    Submit test
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Right Rail: Question Palette */}
          <Card className="lg:col-span-4 p-6 space-y-5">
            <div className="border-b border-line pb-3 flex items-center justify-between">
              <h3 className="font-semibold text-base text-ink">
                Question palette
              </h3>
              <span className="text-xs text-ink-muted">
                {answeredCount} of {totalQuestions} answered
              </span>
            </div>

            {/* Grid Numbers */}
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const isAnswered = answers[q.id] !== undefined;
                const isMarked = !!markedForReview[q.id];
                const isCurrent = currentIndex === idx;

                let stateClass = "border-line text-ink-muted bg-paper hover:bg-surface";
                if (isAnswered) {
                  stateClass = "bg-pen text-white border-pen font-semibold";
                } else if (isMarked) {
                  stateClass = "border-line bg-surface text-ink font-semibold relative";
                }

                if (isCurrent) {
                  stateClass += " ring-2 ring-pen ring-offset-1";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-9 rounded-lg border text-xs flex items-center justify-center transition-colors cursor-pointer relative ${stateClass}`}
                  >
                    {idx + 1}
                    {isMarked && !isAnswered && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ink" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="border-t border-line pt-4 grid grid-cols-2 gap-2 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded bg-pen inline-block" />
                <span>Answered</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded border border-line bg-paper inline-block" />
                <span>Unanswered</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded border border-line bg-surface inline-block relative">
                  <span className="absolute top-0 right-0 w-1 h-1 rounded-full bg-ink" />
                </span>
                <span>Review</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded ring-1 ring-pen inline-block" />
                <span>Current</span>
              </div>
            </div>

            {/* Keyboard Shortcuts Hint */}
            <div className="border-t border-line pt-4 text-xs text-ink-muted space-y-1">
              <div>Keys 1–4: select option</div>
              <div>Left/Right arrows: previous/next</div>
              <div>Key M: mark for review</div>
            </div>
          </Card>
        </div>
      </div>
    </StudentGuard>
  );
}
