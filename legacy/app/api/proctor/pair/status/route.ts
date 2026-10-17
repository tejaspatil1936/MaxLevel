import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { apiSuccess, apiError } from "@/lib/response";
import { requireStudent } from "@/lib/auth";
import { Attempt } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const attemptId = searchParams.get("attemptId");
    const testId = searchParams.get("testId");

    // 1. Direct attemptId or testId query
    if (attemptId || testId) {
      const authResult = await requireStudent(req);
      if ("errorResponse" in authResult) {
        return authResult.errorResponse;
      }
      const user = authResult.user;
      const effectiveAttemptId = attemptId || `${testId}_${user.uid}`;

      const attemptRef = adminDb.collection("attempts").doc(effectiveAttemptId);
      const attemptDoc = await attemptRef.get();

      if (!attemptDoc.exists) {
        return apiSuccess({
          paired: false,
          strikes: 0,
          status: "not_started",
        });
      }

      const attempt = attemptDoc.data() as Attempt;
      const now = Date.now();
      const phone = attempt.phone || {};
      const isAlive = phone.lastBeatAt ? now - phone.lastBeatAt < 150_000 : false;

      // Extract recent phone events for banner display
      const recentPhoneEvents = (attempt.events || [])
        .filter((e: any) => e.scope === "phone" || e.type?.startsWith("PHONE_") || e.type?.startsWith("NO_FACE") || e.type?.startsWith("MULTI_FACE") || e.type?.startsWith("CAMERA_BLOCKED") || e.type?.startsWith("LOOK_AWAY") || e.type?.startsWith("DEVICE_MOVED") || e.type?.startsWith("PAGE_HIDDEN") || e.type?.startsWith("HEARTBEAT_LOST"))
        .slice(-5);

      return apiSuccess({
        paired: Boolean(phone.paired),
        active: Boolean(phone.active),
        monitoring: Boolean(phone.monitoring),
        strikes: phone.strikes || 0,
        isPhoneAlive: isAlive,
        lastBeatAt: phone.lastBeatAt || null,
        status: attempt.status,
        pausedUntil: phone.pausedUntil || null,
        recentEvents: recentPhoneEvents,
      });
    }

    // 2. Legacy sessionId + token query (backward compatibility)
    const sessionId = searchParams.get("sessionId");
    const token = searchParams.get("token");

    if (!sessionId || !token) {
      return apiError("Missing attemptId, testId, or sessionId parameter", 400);
    }

    const sessionDoc = await adminDb.collection("proctorSessions").doc(sessionId).get();
    if (!sessionDoc.exists) {
      return apiError("Session not found", 404);
    }

    const session = sessionDoc.data();
    if (session?.token !== token) {
      return apiError("Session token mismatch", 403);
    }

    const now = Date.now();
    const isPhoneAlive = session.lastPingPhone && now - session.lastPingPhone < 12000;

    return apiSuccess({
      session: {
        id: session.id,
        testId: session.testId,
        studentName: session.studentName,
        studentPrn: session.studentPrn,
        status: isPhoneAlive ? session.status : "disconnected",
        isPhoneAlive: Boolean(isPhoneAlive),
        lastPingPhone: session.lastPingPhone,
        offer: session.offer,
        answer: session.answer,
        candidatesLaptop: session.candidatesLaptop || [],
        candidatesPhone: session.candidatesPhone || [],
        phoneState: session.phoneState,
      },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch session status", 500);
  }
}
