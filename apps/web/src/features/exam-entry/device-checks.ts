import type { ExamEntry } from '@mitaoe/shared';

// The preflight checks (EX-01, spec 7.1 step 2) and the rules screen's Start conditions (EX-02), as plain functions.

export type CheckId = 'screen' | 'fullscreen' | 'camera' | 'face' | 'connection' | 'clock' | 'browser';
export type CheckStatus = 'checking' | 'passed' | 'failed';

/** The narrowest viewport the exam screen is laid out for, in CSS px. */
export const MIN_SCREEN_WIDTH = 1024;
/** The furthest the device clock may be from the server's (EX-06 shows server time either way). */
export const MAX_CLOCK_OFFSET_MS = 5 * 60_000;

/** The checks a test needs, in the order the screen lists them. */
export function checksFor(exam: Pick<ExamEntry, 'fullscreenRequired' | 'cameraRequired'>): CheckId[] {
  return [
    'screen',
    ...(exam.fullscreenRequired ? (['fullscreen'] as const) : []),
    ...(exam.cameraRequired ? (['camera', 'face'] as const) : []),
    'connection',
    'clock',
    'browser',
  ];
}

const MIN_VERSION = { chromium: 120, firefox: 120, safari: 17 };

/**
 * Current Chrome, Edge or Firefox (version 120, December 2023, or later) or Safari 17 or later, from the user agent.
 * Headless Chrome counts as Chrome; Chrome and Firefox on iOS (WebKit underneath) and other engines do not pass.
 */
export function browserSupported(userAgent: string): boolean {
  const version = (re: RegExp) => Number(re.exec(userAgent)?.[1] ?? 0);
  if (/Firefox\/\d/.test(userAgent)) return version(/Firefox\/(\d+)/) >= MIN_VERSION.firefox;
  if (/Edg\/\d/.test(userAgent)) return version(/Edg\/(\d+)/) >= MIN_VERSION.chromium;
  if (/(?:Headless)?Chrome\/\d/.test(userAgent)) return version(/Chrome\/(\d+)/) >= MIN_VERSION.chromium;
  if (/Safari\/\d/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent))
    return version(/Version\/(\d+)/) >= MIN_VERSION.safari;
  return false;
}

/** Whole seconds between the device clock and the server's, and whether that is close enough. */
export function clockCheck(offsetMs: number): { passed: boolean; seconds: number } {
  return { passed: Math.abs(offsetMs) <= MAX_CLOCK_OFFSET_MS, seconds: Math.round(Math.abs(offsetMs) / 1000) };
}

export type StartBlock = 'checks' | 'agreement' | 'phone';

/** The first condition the rules screen still waits for before `Start test`, or null when it may start (EX-02). */
export function startBlock(s: {
  checksPassed: boolean;
  agreed: boolean;
  secondCamera: boolean;
  phoneConnected: boolean;
}): StartBlock | null {
  if (!s.checksPassed) return 'checks';
  if (!s.agreed) return 'agreement';
  if (s.secondCamera && !s.phoneConnected) return 'phone';
  return null;
}

// Passed checks are kept for the browser session (this tab), so the rules screen knows them.
const key = (testId: string) => `mitaoe.preflight.${testId}`;

export function rememberChecksPassed(testId: string, passed: boolean): void {
  try {
    if (passed) sessionStorage.setItem(key(testId), '1');
    else sessionStorage.removeItem(key(testId));
  } catch {
    // Storage blocked: the student runs the checks again on the next visit.
  }
}

export function checksPassed(testId: string): boolean {
  try {
    return sessionStorage.getItem(key(testId)) === '1';
  } catch {
    return false;
  }
}
