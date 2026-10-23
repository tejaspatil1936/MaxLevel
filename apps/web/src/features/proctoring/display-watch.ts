// The exam's display rule: one screen. Chromium browsers say whether the desktop extends over more than one screen
// (`screen.isExtended`, no permission prompt) and fire `change` on `window.screen` when a screen is plugged in or out.
// A second screen is reported once per incident as `dual_monitor` (a strike) and blocks the exam until it is gone.
// Mirrored screens, HDMI splitters and screen-sharing apps are invisible to a web page; browsers without
// `isExtended` (Firefox, Safari) report nothing.

/** How often the screen layout is looked at again, besides the browser's `change` events. */
export const DISPLAY_CHECK_MS = 5_000;

export interface DisplayDeps {
  /** `screen.isExtended`: true with more than one screen, undefined where the browser cannot tell. */
  isExtended: () => boolean | undefined;
  /** Calls `fn` whenever the screens may have changed; returns a function that stops it. */
  onChange: (fn: () => void) => () => void;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every: (fn: () => void, ms: number) => () => void;
  report: (type: 'dual_monitor', details: Record<string, string | number | boolean | null>) => void;
  /** The exam is blocked (a second screen is connected) or free again. */
  onBlocked: (blocked: boolean) => void;
}

export interface DisplayWatch {
  /** Looks again now (the student says they unplugged the screen). */
  check(): void;
  stop(): void;
}

export function startDisplayWatch(deps: DisplayDeps): DisplayWatch {
  let blocked = false;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    const extended = deps.isExtended() === true;
    if (extended === blocked) return;
    blocked = extended;
    deps.onBlocked(blocked);
    if (blocked) deps.report('dual_monitor', { extended: true });
  };
  const offChange = deps.onChange(check);
  const offEvery = deps.every(check, DISPLAY_CHECK_MS);
  check();
  return {
    check,
    stop() {
      stopped = true;
      offChange();
      offEvery();
    },
  };
}

/**
 * Software cameras that can play any video as the webcam: a recording, another person, a screen. Matched on the
 * camera's label, which the browser shows once the camera is allowed. Phone-as-webcam apps are left out: they are a
 * real camera.
 */
const VIRTUAL_CAMERAS = [
  /\bobs\b/i,
  /virtual/i,
  /manycam/i,
  /xsplit/i,
  /snap camera/i,
  /mmhmm/i,
  /splitcam/i,
  /camtwist/i,
  /e2esoft|\bvcam\b/i,
  /chromacam/i,
  /youcam/i,
];

/** Whether a camera label names a virtual camera. */
export function isVirtualCamera(label: string | null | undefined): boolean {
  return !!label && VIRTUAL_CAMERAS.some((pattern) => pattern.test(label));
}
