import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { apiSuccess, apiError } from "@/lib/response";
import { proctorSignalBus } from "@/lib/proctor-signal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sessionId, token, inForeground, cameraOk, battery, moved, facingMode, preview } = body;

    if (!sessionId || !token) {
      return apiError("sessionId and token are required", 400);
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

    const now = Date.now();
    const existingPreview = session?.phoneState?.preview || null;
    const finalPreview = preview || existingPreview;

    const phoneStateUpdate: Record<string, any> = {
      inForeground: inForeground !== undefined ? Boolean(inForeground) : true,
      cameraOk: cameraOk !== undefined ? Boolean(cameraOk) : true,
      battery: battery !== undefined ? battery : null,
      moved: moved !== undefined ? Boolean(moved) : false,
      facingMode: facingMode || "environment",
      updatedAt: now,
    };
    if (finalPreview) {
      phoneStateUpdate.preview = finalPreview;
    }

    await sessionRef.update({
      lastPingPhone: now,
      status: "connected",
      phoneState: phoneStateUpdate,
    });

    // Instantly push phone state & preview to laptop SSE stream
    proctorSignalBus.emitSignal(sessionId, {
      type: "phone_state",
      data: phoneStateUpdate,
      from: "phone",
    });

    return apiSuccess({ received: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record heartbeat", 500);
  }
}
