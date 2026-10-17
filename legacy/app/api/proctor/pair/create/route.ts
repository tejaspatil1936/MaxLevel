import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { signToken } from "@/lib/proctorToken";
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
    const testId = body?.testId;
    if (!testId || typeof testId !== "string") {
      return apiError("testId is required", 400);
    }

    const attemptId = `${testId}_${user.uid}`;
    const pairToken = signToken({
      aid: attemptId,
      uid: user.uid,
      role: "pair",
      exp: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const existingDoc = await attemptRef.get();
    if (existingDoc.exists) {
      const ex = existingDoc.data() as Attempt;
      if (
        ex.status === "submitted" ||
        ex.status === "auto_submitted" ||
        ex.status === "terminated_by_proctor"
      ) {
        return apiError("You have already completed or submitted this assessment.", 400);
      }
    }

    await attemptRef.set(
      {
        id: attemptId,
        testId,
        uid: user.uid,
        status: "awaiting_start",
        submitReason: null,
        submitReasonDetail: null,
        phone: {
          paired: false,
          active: false,
          strikes: 0,
          last: {},
          lastBeatAt: Date.now(),
        },
      },
      { merge: true }
    );

    return apiSuccess({
      pairToken,
      attemptId,
      message: "Pair token created",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to create pair token", 500);
  }
}
