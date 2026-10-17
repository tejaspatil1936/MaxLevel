import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyToken } from "@/lib/proctorToken";
import { applyPhoneEvent } from "@/lib/phoneStrikes";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { Attempt } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const now = Date.now();

    // 1. Phone heartbeat (with device token)
    if (body?.token) {
      const payload = verifyToken(body.token);
      if (!payload || payload.role !== "device") {
        return apiError("Unauthorized device token", 401);
      }

      const attemptRef = adminDb.collection("attempts").doc(payload.aid);
      const doc = await attemptRef.get();
      if (!doc.exists) {
        return apiError("Attempt not found", 404);
      }
      const attempt = doc.data() as Attempt;

      // Update phone heartbeat timestamp
      await attemptRef.update({ "phone.lastBeatAt": now });

      const status = (attempt.status as string) || "awaiting_start";
      const strikes = typeof attempt.phone?.strikes === "number" ? attempt.phone.strikes : 0;
      const isExamActive = status === "in_progress";
      const isQuotaTerminated =
        (isExamActive && strikes >= 5) ||
        (status === "terminated_by_proctor" && Boolean(attempt.phone?.active));
      const isExamCompleted =
        status === "submitted" ||
        status === "auto_submitted" ||
        status === "completed";
      const isAwaitingStart = !attempt.status || status === "ready" || status === "awaiting_start";

      return apiSuccess({
        ok: true,
        role: "device",
        status: attempt.status || "awaiting_start",
        strikes,
        isExamActive,
        isAwaitingStart,
        terminate: isQuotaTerminated,
        completed: isExamCompleted,
        timestamp: now,
      });
    }

    // 2. Laptop heartbeat (with student session + attemptId)
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;
    const attemptId = body?.attemptId;

    if (!attemptId || typeof attemptId !== "string") {
      return apiError("Missing attemptId or device token", 400);
    }

    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const doc = await attemptRef.get();
    if (!doc.exists) {
      return apiError("Attempt not found", 404);
    }

    const attempt = doc.data() as Attempt;
    if (attempt.uid !== user.uid) {
      return apiError("Unauthorized to access attempt", 403);
    }

    let heartbeatLostApplied = false;
    let silenceMs = 0;

    if (attempt.phone?.paired && attempt.phone?.lastBeatAt) {
      silenceMs = now - attempt.phone.lastBeatAt;
      if (silenceMs > 150_000 && attempt.status === "in_progress") {
        await applyPhoneEvent(attemptId, "HEARTBEAT_LOST", { durationMs: silenceMs });
        heartbeatLostApplied = true;
      }
    }

    // Re-fetch or calculate fresh state
    const freshDoc = heartbeatLostApplied ? await attemptRef.get() : doc;
    const freshAttempt = freshDoc.data() as Attempt;

    // Extract recent phone events for instant banner display on laptop
    const recentPhoneEvents = (freshAttempt.events || [])
      .filter(
        (e: any) =>
          e.scope === "phone" ||
          e.type?.startsWith("PHONE_") ||
          e.type?.startsWith("NO_FACE") ||
          e.type?.startsWith("MULTI_FACE") ||
          e.type?.startsWith("CAMERA_BLOCKED") ||
          e.type?.startsWith("LOOK_AWAY") ||
          e.type?.startsWith("DEVICE_MOVED") ||
          e.type?.startsWith("PAGE_HIDDEN") ||
          e.type?.startsWith("HEARTBEAT_LOST") ||
          e.type?.startsWith("BOOK_")
      )
      .slice(-10);

    return apiSuccess({
      ok: true,
      role: "laptop",
      paired: Boolean(freshAttempt.phone?.paired),
      active: Boolean(freshAttempt.phone?.active),
      strikes: freshAttempt.phone?.strikes || 0,
      phoneActive: freshAttempt.phone?.lastBeatAt ? silenceMs <= 150_000 : false,
      pausedUntil: freshAttempt.phone?.pausedUntil || null,
      status: freshAttempt.status,
      lastEvent: (freshAttempt.phone as any)?.lastEvent || null,
      recentEvents: recentPhoneEvents,
      timestamp: now,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to process heartbeat", 500);
  }
}
