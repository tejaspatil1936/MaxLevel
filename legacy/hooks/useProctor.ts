"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { apiClient } from "@/lib/apiClient";
import { ViolationType, ViolationResponse } from "@/types";

export interface ProctorOptions {
  attemptId: string;
  isActive: boolean;
  onAutoSubmit: (reason: string, detail?: string) => void;
  onStrikeRecorded?: (strike: number, max: number, message: string) => void;
  getCurrentAnswers: () => Record<string, number>;
}

export function useProctor({
  attemptId,
  isActive,
  onAutoSubmit,
  onStrikeRecorded,
  getCurrentAnswers,
}: ProctorOptions) {
  const [strikes, setStrikes] = useState(0);
  const [maxStrikes, setMaxStrikes] = useState(3);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(true);

  // Tracking flags & timers
  const hasEnteredFullscreenOnce = useRef(false);
  const lastBlurTimestamp = useRef(0);
  const lastViolationTimestamp = useRef(0);
  const suppressDevtoolsUntil = useRef(0);
  const devtoolsReported = useRef(false);
  const isAutoSubmittedRef = useRef(false);

  // Queue for failed violations
  const failedViolationsQueue = useRef<
    Array<{ type: ViolationType; message: string; meta?: any }>
  >([]);

  // Flush queued violations
  const flushQueue = useCallback(async () => {
    if (
      !failedViolationsQueue.current.length ||
      !isActive ||
      !attemptId ||
      isAutoSubmittedRef.current
    ) {
      return;
    }
    const queue = [...failedViolationsQueue.current];
    failedViolationsQueue.current = [];

    for (const item of queue) {
      try {
        const answers = getCurrentAnswers();
        const res = await apiClient.post<ViolationResponse>(
          `/api/attempts/${attemptId}/violation`,
          { type: item.type, meta: item.meta, answers }
        );
        setStrikes(res.strikes);
        setMaxStrikes(res.max);
        if (res.autoSubmit) {
          isAutoSubmittedRef.current = true;
          onAutoSubmit(
            res.submitReason || "violations",
            res.submitReasonDetail || item.message
          );
          break;
        }
      } catch {
        // Re-queue on failure
        failedViolationsQueue.current.push(item);
        break;
      }
    }
  }, [attemptId, isActive, onAutoSubmit, getCurrentAnswers]);

  // Report violation to server
  const reportViolation = useCallback(
    async (type: ViolationType, message: string, meta?: any) => {
      if (!isActive || !attemptId || isAutoSubmittedRef.current) return;

      const now = Date.now();

      // Rule: Never let one user action record two violations (deduplicate within 1.5s for non-shortcuts)
      if (type !== "devtools_shortcut" && type !== "reload") {
        if (now - lastViolationTimestamp.current < 1500) {
          return;
        }
        lastViolationTimestamp.current = now;
      }

      try {
        const answers = getCurrentAnswers();
        const res = await apiClient.post<ViolationResponse>(
          `/api/attempts/${attemptId}/violation`,
          {
            type,
            meta,
            answers,
          }
        );

        setStrikes(res.strikes);
        setMaxStrikes(res.max);

        if (res.autoSubmit) {
          isAutoSubmittedRef.current = true;
          onAutoSubmit(
            res.submitReason || "violations",
            res.submitReasonDetail || message
          );
        } else if (res.strikes > 0 && type !== "reload") {
          setWarningMessage(
            `Warning Strike ${res.strikes} of ${res.max}: ${message}`
          );
          onStrikeRecorded?.(res.strikes, res.max, message);
        }
      } catch {
        // Network failure: queue violation for retry
        failedViolationsQueue.current.push({ type, message, meta });
      }
    },
    [attemptId, isActive, onAutoSubmit, onStrikeRecorded, getCurrentAnswers]
  );

  // Request fullscreen
  const requestFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(true);
      hasEnteredFullscreenOnce.current = true;
      suppressDevtoolsUntil.current = Date.now() + 2000;
    } catch {
      // Fullscreen request may fail if no user gesture
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    // Flush any pending queue on reconnect
    const handleOnline = () => {
      flushQueue();
    };
    window.addEventListener("online", handleOnline);

    // 1. Fullscreen change listener
    const handleFullscreenChange = () => {
      const activeFs = !!document.fullscreenElement;
      setIsFullscreen(activeFs);

      // Suppress devtools-size heuristic for 2 seconds after any fullscreen change
      suppressDevtoolsUntil.current = Date.now() + 2000;

      // Do NOT count initial fullscreen entry as violation
      if (!activeFs && hasEnteredFullscreenOnce.current) {
        reportViolation("fullscreen_exit", "Exited fullscreen mode. Stay in fullscreen.");
      } else if (activeFs) {
        hasEnteredFullscreenOnce.current = true;
      }
    };

    // 2. Tab switch / window blur listener (debounced to max 1 per second)
    const handleVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        if (now - lastBlurTimestamp.current > 1000) {
          lastBlurTimestamp.current = now;
          reportViolation("tab_switch", "Tab switched or minimized. Stay on the exam tab.");
        }
      }
    };

    const handleWindowBlur = () => {
      const now = Date.now();
      if (now - lastBlurTimestamp.current > 1000) {
        lastBlurTimestamp.current = now;
        reportViolation("tab_switch", "Window lost focus. Keep the exam window active.");
      }
    };

    // 3. Clipboard blocking (Copy, Cut, Paste) -> strike
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation("copy", "Copying content is disabled during the exam.");
    };

    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation("cut", "Cutting content is disabled during the exam.");
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation("paste", "Pasting content is disabled during the exam.");
    };

    // 4. Silent blocking (Right click context menu, Selection, Drag) -> no strike
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    // 5. DevTools shortcuts (Capture phase) -> instant auto-submit
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      const isF12 = e.key === "F12" || e.keyCode === 123;
      const isDevToolsInspect =
        isCmdOrCtrl && e.shiftKey && (key === "i" || key === "j" || key === "c");
      const isViewSource = isCmdOrCtrl && key === "u";
      const isMacOptionInspect =
        e.metaKey && e.altKey && (key === "i" || key === "j" || key === "u");

      if (isF12 || isDevToolsInspect || isViewSource || isMacOptionInspect) {
        e.preventDefault();
        e.stopPropagation();
        reportViolation(
          "devtools_shortcut",
          "Developer tools shortcut detected. Test automatically submitted.",
          { key: e.key }
        );
      }
    };

    // 6. DevTools open heuristic (outer vs inner window delta)
    const devtoolsInterval = setInterval(() => {
      // Suppress during and 2s after fullscreen transitions
      if (Date.now() < suppressDevtoolsUntil.current) {
        return;
      }

      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;
      const threshold = 160;

      if (widthDelta > threshold || heightDelta > threshold) {
        if (!devtoolsReported.current) {
          devtoolsReported.current = true;
          reportViolation("devtools_open", "Developer tools panel detected.", {
            widthDelta,
            heightDelta,
          });
        }
      } else {
        devtoolsReported.current = false;
      }
    }, 1000);

    // 7. Navigation/reload warning
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      reportViolation("reload", "Page reload detected.");
      return "";
    };

    // 8. Multiple screens detection via Window Management API / screen.isExtended
    let screenDetailsInstance: any = null;
    const handleScreensChange = () => {
      if (screenDetailsInstance && screenDetailsInstance.screens.length > 1) {
        reportViolation(
          "multiple_screens",
          `Multiple displays detected (${screenDetailsInstance.screens.length} monitors). Multi-screen usage is prohibited.`,
          { screenCount: screenDetailsInstance.screens.length }
        );
      }
    };

    if (typeof window !== "undefined") {
      if ("getScreenDetails" in window) {
        (window as any)
          .getScreenDetails()
          .then((details: any) => {
            screenDetailsInstance = details;
            if (details.screens.length > 1) {
              reportViolation(
                "multiple_screens",
                `Multiple displays detected (${details.screens.length} monitors). Multi-screen usage is prohibited.`,
                { screenCount: details.screens.length }
              );
            }
            details.addEventListener("screenschange", handleScreensChange);
          })
          .catch(() => {
            // Permission dismissed or not granted
          });
      } else if ((window.screen as any)?.isExtended) {
        reportViolation(
          "multiple_screens",
          "Extended multiple monitor display detected.",
          { isExtended: true }
        );
      }
    }

    // Attach listeners
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);

    document.addEventListener("copy", handleCopy);
    document.addEventListener("cut", handleCut);
    document.addEventListener("paste", handlePaste);

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("selectstart", handleSelectStart);
    document.addEventListener("dragstart", handleDragStart);

    // Capture phase for keyboard
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);

      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("cut", handleCut);
      document.removeEventListener("paste", handlePaste);

      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("selectstart", handleSelectStart);
      document.removeEventListener("dragstart", handleDragStart);

      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearInterval(devtoolsInterval);

      if (screenDetailsInstance) {
        screenDetailsInstance.removeEventListener("screenschange", handleScreensChange);
      }
    };
  }, [isActive, reportViolation, flushQueue]);

  return {
    strikes,
    maxStrikes,
    warningMessage,
    dismissWarning: () => setWarningMessage(null),
    isFullscreen,
    requestFullscreen,
    reportViolation,
  };
}
