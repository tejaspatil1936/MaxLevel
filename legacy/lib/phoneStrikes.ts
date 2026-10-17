import { adminDb } from "./firebase-admin";
import { gradeAnswers } from "./grade";
import { Attempt, AnswerKeysDoc } from "@/types";

export const MAX_PHONE_STRIKES = 5;

export type PhoneRule = { weight: number; cooldownMs: number; minDurationMs: number };

export const PHONE_RULES: Record<string, PhoneRule> = {
  NO_FACE:        { weight: 1,   cooldownMs: 12_000,  minDurationMs: 4_000 },
  MULTI_FACE:     { weight: 1,   cooldownMs: 15_000,  minDurationMs: 2_000 },
  PHONE_OBJECT:   { weight: 1,   cooldownMs: 15_000,  minDurationMs: 0 },
  BOOK_OBJECT:    { weight: 0.5, cooldownMs: 30_000,  minDurationMs: 2_000 },
  LOOK_AWAY:      { weight: 0.5, cooldownMs: 45_000,  minDurationMs: 3_000 },
  CAMERA_BLOCKED: { weight: 1,   cooldownMs: 15_000,  minDurationMs: 3_000 },
  DEVICE_MOVED:   { weight: 0.5, cooldownMs: 30_000,  minDurationMs: 0 },
  PAGE_HIDDEN:    { weight: 1,   cooldownMs: 15_000,  minDurationMs: 4_000 },
  HEARTBEAT_LOST: { weight: 1,   cooldownMs: 45_000,  minDurationMs: 0 },
};

export async function applyPhoneEvent(
  attemptId: string,
  type: string,
  meta: { confidence?: number; durationMs?: number } = {}
) {
  const rule = PHONE_RULES[type];
  if (!rule) return { ok: false, reason: "unknown_type" as const };

  const ref = adminDb.collection("attempts").doc(attemptId);
  const now = Date.now();

  return adminDb.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { ok: false, reason: "not_found" as const };
    const a = doc.data() as Attempt;
    if (!a || a.status !== "in_progress") return { ok: false, reason: "not_active" as const };

    const deadlineMs = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Infinity;
    if (now > deadlineMs + 30_000) return { ok: false, reason: "expired" as const };

    // Check emergency pause
    if (a.phone?.pausedUntil && now < a.phone.pausedUntil) {
      return { ok: true, paused: true, counted: false, strikes: a.phone?.strikes || 0 };
    }

    if ((meta.durationMs ?? 0) < rule.minDurationMs) {
      return { ok: true, counted: false, strikes: a.phone?.strikes || 0 };
    }

    const phone = a.phone ?? { strikes: 0, last: {} };
    if (now - (phone.last?.[type] ?? 0) < rule.cooldownMs) {
      return { ok: true, counted: false, strikes: phone.strikes || 0 };
    }

    const strikes = Math.round(((phone.strikes || 0) + rule.weight) * 2) / 2;
    const events = [
      ...(a.events ?? []),
      {
        scope: "phone",
        type,
        at: new Date(now).toISOString(),
        t: now,
        weight: rule.weight,
        meta: {
          confidence: meta.confidence ?? null,
          durationMs: meta.durationMs ?? null,
        },
      },
    ].slice(-50);
    const terminate = strikes >= MAX_PHONE_STRIKES;

    const updates: Record<string, any> = {
      "phone.strikes": strikes,
      "phone.lastBeatAt": now,
      "phone.lastEvent": { type, t: now, weight: rule.weight },
      [`phone.last.${type}`]: now,
      events,
    };

    if (terminate) {
      updates.status = "terminated_by_proctor";
      updates.submitReason = "terminated_by_proctor";
      updates.submitReasonDetail = "Secondary phone proctor quota exceeded (5/5 strikes)";
      updates.submittedAt = new Date(now).toISOString();

      const startedMs = new Date(a.startedAt).getTime();
      const rawSec = isNaN(startedMs) ? 0 : Math.round((now - startedMs) / 1000);
      updates.timeTakenSec = Math.max(0, rawSec);

      try {
        const akDoc = await adminDb.collection("answerKeys").doc(a.testId).get();
        const ak = (akDoc.data() as AnswerKeysDoc)?.answers || {};
        const { score, total } = gradeAnswers(a.answers || {}, ak);
        updates.score = score;
        updates.total = total;
      } catch {
        // Fallback keep current score/total if key fetch fails
      }
    }

    tx.update(ref, updates);
    return { ok: true, counted: true, strikes, terminate };
  });
}

export async function pausePhoneStrikes(attemptId: string) {
  const ref = adminDb.collection("attempts").doc(attemptId);
  const now = Date.now();
  return adminDb.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { ok: false, error: "Attempt not found" };
    const a = doc.data() as Attempt;
    if (a.status !== "in_progress") return { ok: false, error: "Attempt not in progress" };
    if (a.phone?.pauseUsed) return { ok: false, error: "Emergency pause already used" };

    const pausedUntil = now + 120_000;
    const events = [
      ...(a.events ?? []),
      {
        scope: "phone",
        type: "PHONE_EMERGENCY_PAUSE",
        at: new Date(now).toISOString(),
        t: now,
        meta: { pausedUntil },
      },
    ].slice(-50);

    tx.update(ref, {
      "phone.pausedUntil": pausedUntil,
      "phone.pauseUsed": true,
      events,
    });
    return { ok: true, pausedUntil };
  });
}
