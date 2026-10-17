import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { apiSuccess, apiError } from "@/lib/response";
import { proctorSignalBus } from "@/lib/proctor-signal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sessionId, token, from, type, data } = body;

    if (!sessionId || !token || !from || !type) {
      return apiError("Missing required signaling parameters", 400);
    }

    if (from !== "laptop" && from !== "phone") {
      return apiError("Invalid sender identifier", 400);
    }

    const sessionRef = adminDb.collection("proctorSessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      return apiError("Session not found", 404);
    }

    const session = sessionDoc.data();
    if (session?.token !== token) {
      return apiError("Invalid session token", 403);
    }

    const updates: Record<string, any> = {};

    if (type === "offer") {
      updates.offer = data;
      updates.answer = null;
      updates.candidatesLaptop = [];
      updates.candidatesPhone = [];
    } else if (type === "answer") {
      updates.answer = data;
      updates.status = "connected";
      updates.lastPingPhone = Date.now();
    } else if (type === "candidate") {
      const field = from === "laptop" ? "candidatesLaptop" : "candidatesPhone";
      const existing = session?.[field] || [];
      // Keep up to 25 candidates to avoid document bloat
      if (existing.length < 25) {
        updates[field] = [...existing, data];
      }
    } else if (type === "clear_candidates") {
      updates.candidatesLaptop = [];
      updates.candidatesPhone = [];
    }

    if (from === "phone") {
      updates.lastPingPhone = Date.now();
    }

    if (Object.keys(updates).length > 0) {
      await sessionRef.update(updates);
    }

    // Instantly notify connected peer via SSE stream (< 5ms latency!)
    proctorSignalBus.emitSignal(sessionId, {
      type: type as any,
      data,
      from,
    });

    return apiSuccess({ message: "Signal recorded" });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record signal", 500);
  }
}
