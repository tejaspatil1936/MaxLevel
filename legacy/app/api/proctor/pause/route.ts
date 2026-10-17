import { NextRequest } from "next/server";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { pausePhoneStrikes } from "@/lib/phoneStrikes";
import { adminDb } from "@/lib/firebase-admin";
import { Attempt } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attemptId;
    if (!attemptId || typeof attemptId !== "string") {
      return apiError("attemptId is required", 400);
    }

    const doc = await adminDb.collection("attempts").doc(attemptId).get();
    if (!doc.exists) {
      return apiError("Attempt not found", 404);
    }

    const attempt = doc.data() as Attempt;
    if (attempt.uid !== user.uid) {
      return apiError("Unauthorized to modify attempt", 403);
    }

    const result = await pausePhoneStrikes(attemptId);
    if (!result.ok) {
      return apiError(result.error || "Cannot pause phone strikes", 400);
    }

    return apiSuccess({
      ok: true,
      pausedUntil: result.pausedUntil,
      durationMs: 120_000,
      message: "Phone strikes paused for 2 minutes",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to trigger emergency pause", 500);
  }
}
