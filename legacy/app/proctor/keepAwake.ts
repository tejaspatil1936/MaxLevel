"use client";

/**
 * Screen wake lock & foreground monitoring
 */
export function keepAwake(onHidden?: () => void): () => void {
  let wakeLock: any = null;
  let isDisposed = false;

  const requestLock = async () => {
    if (isDisposed) return;
    try {
      if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        wakeLock = await (navigator as any).wakeLock.request("screen");
        wakeLock.addEventListener?.("release", () => {
          if (!isDisposed && document.visibilityState === "visible") {
            requestLock();
          }
        });
      }
    } catch {
      // Wake lock request failed or not supported
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      requestLock();
    } else {
      onHidden?.();
    }
  };

  requestLock();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    isDisposed = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    try {
      wakeLock?.release?.();
    } catch {}
  };
}

/**
 * Orientation change monitor (triggers if angle changes > 20° sustained for > 3s)
 */
export function watchOrientation(onMoved: () => void): () => void {
  let baseBeta: number | null = null;
  let baseGamma: number | null = null;
  let movedTimer: NodeJS.Timeout | null = null;
  let isDisposed = false;

  const handleOrientation = (event: DeviceOrientationEvent) => {
    if (isDisposed) return;
    const { beta, gamma } = event;
    if (beta === null || gamma === null) return;

    if (baseBeta === null || baseGamma === null) {
      baseBeta = beta;
      baseGamma = gamma;
      return;
    }

    const deltaBeta = Math.abs(beta - baseBeta);
    const deltaGamma = Math.abs(gamma - baseGamma);
    const hasMoved = deltaBeta > 20 || deltaGamma > 20;

    if (hasMoved) {
      if (!movedTimer) {
        movedTimer = setTimeout(() => {
          if (!isDisposed) {
            onMoved();
          }
          movedTimer = null;
        }, 3000);
      }
    } else {
      if (movedTimer) {
        clearTimeout(movedTimer);
        movedTimer = null;
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("deviceorientation", handleOrientation);
  }

  return () => {
    isDisposed = true;
    if (movedTimer) clearTimeout(movedTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("deviceorientation", handleOrientation);
    }
  };
}

/**
 * Check if motion sensors are supported and permission state
 */
export async function checkMotionPermission(): Promise<"granted" | "prompt" | "denied"> {
  if (typeof window === "undefined") return "denied";
  if (typeof DeviceOrientationEvent === "undefined") {
    return "denied";
  }
  if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
    return "prompt";
  }
  return "granted";
}

/**
 * Request device orientation permissions (required on iOS Safari)
 */
export async function requestOrientationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
    return false;
  }
  if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
    try {
      const response = await (DeviceOrientationEvent as any).requestPermission();
      return response === "granted";
    } catch {
      return false;
    }
  }
  return true;
}
