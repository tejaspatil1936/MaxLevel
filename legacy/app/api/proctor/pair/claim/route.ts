import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { apiSuccess, apiError } from "@/lib/response";
import { verifyToken, signToken } from "@/lib/proctorToken";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pairToken = body?.token;
    if (!pairToken || typeof pairToken !== "string") {
      return apiError("Missing pairing token", 400);
    }

    const payload = verifyToken(pairToken);
    if (!payload || payload.role !== "pair") {
      return apiError("Invalid or expired pairing token. Please rescan the QR code.", 401);
    }

    const now = Date.now();
    const attemptRef = adminDb.collection("attempts").doc(payload.aid);
    const attemptDoc = await attemptRef.get();

    // Generate device token valid for 4 hours (until attempt completes + grace period)
    const deviceToken = signToken({
      aid: payload.aid,
      uid: payload.uid,
      role: "device",
      exp: now + 4 * 60 * 60 * 1000,
    });

    const phoneUpdate: Record<string, any> = {
      "phone.paired": true,
      "phone.pairedAt": now,
      "phone.lastBeatAt": now,
      "phone.strikes": 0,
      "phone.last": {},
    };

    if (attemptDoc.exists) {
      const existingData = attemptDoc.data();
      const existingStatus = existingData?.status;
      if (
        existingStatus === "submitted" ||
        existingStatus === "auto_submitted" ||
        existingStatus === "terminated_by_proctor"
      ) {
        return apiError("This assessment has already been submitted and concluded.", 400);
      }
      if (existingStatus !== "in_progress") {
        phoneUpdate.status = "awaiting_start";
        phoneUpdate.submitReason = null;
        phoneUpdate.submitReasonDetail = null;
      }
      await attemptRef.update(phoneUpdate);
    } else {
      await attemptRef.set(
        {
          id: payload.aid,
          uid: payload.uid,
          status: "awaiting_start",
          phone: {
            paired: true,
            pairedAt: now,
            lastBeatAt: now,
            strikes: 0,
            last: {},
          },
        },
        { merge: true }
      );
    }

    return apiSuccess({
      ok: true,
      deviceToken,
      attemptId: payload.aid,
      message: "Device paired successfully",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to claim pairing token", 500);
  }
}
