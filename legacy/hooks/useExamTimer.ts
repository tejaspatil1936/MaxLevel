"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export interface UseExamTimerOptions {
  deadlineAt: string;
  serverNow: string;
  onTimeout: () => void;
  isActive: boolean;
  initialDurationSec?: number;
}

export function useExamTimer({
  deadlineAt,
  serverNow,
  onTimeout,
  isActive,
  initialDurationSec = 1800,
}: UseExamTimerOptions) {
  const clockOffsetRef = useRef<number>(0);
  const timeoutFiredRef = useRef(false);

  // Safely calculate remaining seconds
  const calculateRemaining = useCallback((): number => {
    if (!deadlineAt) return initialDurationSec;
    const deadlineTime = new Date(deadlineAt).getTime();
    if (isNaN(deadlineTime)) return initialDurationSec;

    const currentServerTime = Date.now() + clockOffsetRef.current;
    const diffSec = Math.floor((deadlineTime - currentServerTime) / 1000);
    return Math.max(0, isNaN(diffSec) ? 0 : diffSec);
  }, [deadlineAt, initialDurationSec]);

  const [remainingSec, setRemainingSec] = useState<number>(calculateRemaining);

  // Update clock offset whenever serverNow is provided or updated
  useEffect(() => {
    if (serverNow) {
      const serverTime = new Date(serverNow).getTime();
      if (!isNaN(serverTime)) {
        clockOffsetRef.current = serverTime - Date.now();
      }
    }
  }, [serverNow]);

  // Recalculate remaining seconds when deadlineAt or serverNow updates
  useEffect(() => {
    if (deadlineAt) {
      const remaining = calculateRemaining();
      setRemainingSec(remaining);
      timeoutFiredRef.current = false;
    }
  }, [deadlineAt, serverNow, calculateRemaining]);

  // Tick interval while active
  useEffect(() => {
    if (!isActive || !deadlineAt) return;

    // Immediately compute once on active
    const initial = calculateRemaining();
    setRemainingSec(initial);

    const interval = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingSec(remaining);

      if (remaining <= 0 && !timeoutFiredRef.current) {
        timeoutFiredRef.current = true;
        clearInterval(interval);
        onTimeout();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadlineAt, isActive, onTimeout, calculateRemaining]);

  // Formatted timer string: MM:SS or HH:MM:SS
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) {
      const defaultMins = Math.floor(initialDurationSec / 60);
      return `${defaultMins.toString().padStart(2, "0")}:00`;
    }

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const pad = (n: number) => (isNaN(n) ? "00" : n.toString().padStart(2, "0"));
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  const timerStatus: "normal" | "amber" | "red" =
    remainingSec <= 60 ? "red" : remainingSec <= 300 ? "amber" : "normal";

  return {
    remainingSec,
    formatted: formatTime(remainingSec),
    timerStatus,
  };
}
