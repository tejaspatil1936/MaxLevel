import { Test, Series, TestState } from "@/types";

export const DEFAULT_TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";

/**
 * Get current date & time parts in the target timezone
 */
export function getNowInTimezone(tz = DEFAULT_TZ): {
  dateStr: string; // "YYYY-MM-DD"
  minutesFromMidnight: number;
  now: Date;
} {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  let year = "";
  let month = "";
  let day = "";
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
    if (part.type === "hour") hour = parseInt(part.value, 10);
    if (part.type === "minute") minute = parseInt(part.value, 10);
  }

  const dateStr = `${year}-${month}-${day}`;
  const minutesFromMidnight = hour * 60 + minute;

  return { dateStr, minutesFromMidnight, now };
}

export function parseTimeToMinutes(timeStr?: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map((v) => parseInt(v, 10));
  const validH = isNaN(h) ? 0 : h;
  const validM = isNaN(m) ? 0 : m;
  return validH * 60 + validM;
}

/**
 * Determine the state of a test for a given student
 */
export function computeTestState(
  test: Test,
  series?: Series | null,
  attempt?: { status: "in_progress" | "submitted" | "auto_submitted" | "terminated_by_proctor" } | null
): TestState {
  if (attempt) {
    if (
      attempt.status === "submitted" ||
      attempt.status === "auto_submitted" ||
      (attempt.status as string) === "terminated_by_proctor"
    ) {
      return "submitted";
    }
    if (attempt.status === "in_progress") {
      return "open";
    }
  }

  if (!test?.date) return "closed";

  // Effective window
  const defaultWindow = { start: "00:00", end: "23:59", tz: DEFAULT_TZ };
  const window = test.window || series?.window || defaultWindow;
  const tz = series?.window?.tz || DEFAULT_TZ;
  const { dateStr, minutesFromMidnight } = getNowInTimezone(tz);

  const startMinutes = parseTimeToMinutes(window.start || "00:00");
  const endMinutes = parseTimeToMinutes(window.end || "23:59");

  // Compare test date with current date
  if (test.date > dateStr) {
    return "upcoming";
  } else if (test.date < dateStr) {
    return "closed";
  } else {
    // Same day
    if (minutesFromMidnight < startMinutes) {
      return "upcoming";
    } else if (minutesFromMidnight > endMinutes) {
      return "closed";
    } else {
      return "open";
    }
  }
}

/**
 * Format a window string like "07:00 – 15:00 IST"
 */
export function formatWindow(start: string, end: string): string {
  return `${start} – ${end} IST`;
}

/**
 * Format date like "Mon, 12 Oct 2026"
 */
export function formatDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return dateStr;
  }
}

/**
 * Determine whether test results & answer keys are visible to students who completed their attempt.
 *
 * Rules:
 * 1. Admin explicit override `true` -> Always visible
 * 2. Admin explicit override `false` -> Always hidden
 * 3. Default (`null` or `undefined`):
 *    - Auto-released once the test window has ended/closed (e.g., past 11:00 PM or past scheduled date)
 *    - Or if the parent series has resultsVisible === true
 */
export function isTestResultsVisible(
  test: Pick<Test, "date" | "window" | "resultsVisible">,
  series?: Pick<Series, "window" | "resultsVisible"> | null
): boolean {
  if (test.resultsVisible === true) return true;
  if (test.resultsVisible === false) return false;

  const isClosed = computeTestState(test as Test, series as Series | null, null) === "closed";
  return isClosed || Boolean(series?.resultsVisible);
}

