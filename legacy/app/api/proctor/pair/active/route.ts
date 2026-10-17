import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { apiSuccess, apiError } from "@/lib/response";
import { verifyToken } from "@/lib/proctorToken";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const deviceToken = body?.token;
    if (!deviceToken || typeof deviceToken !== "string") {
      return apiError("Missing device token", 400);
    }

    const payload = verifyToken(deviceToken);
    if (!payload || payload.role !== "device") {
      return apiError("Unauthorized device token", 401);
    }

    const now = Date.now();
    const attemptRef = adminDb.collection("attempts").doc(payload.aid);
    const attemptDoc = await attemptRef.get();

    if (!attemptDoc.exists) {
      return apiError("Proctoring attempt not found", 404);
    }

    const attemptData = attemptDoc.data();
    if (
      attemptData?.status === "submitted" ||
      attemptData?.status === "auto_submitted" ||
      attemptData?.status === "terminated_by_proctor"
    ) {
      return apiError("This assessment has already concluded.", 400);
    }

    await attemptRef.update({
      "phone.active": true,
      "phone.monitoring": true,
      "phone.startedAt": now,
      "phone.lastBeatAt": now,
    });

    return apiSuccess({
      ok: true,
      active: true,
      monitoring: true,
      timestamp: now,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to activate mobile monitoring", 500);
  }
}
