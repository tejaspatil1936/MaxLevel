import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { gradeAnswers } from "@/lib/grade";
import { getOrSetCache } from "@/lib/cache";
import { Attempt, AnswerKeysDoc, SubmitResponse, SubmitReason } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;
    const { attemptId } = await context.params;

    const body = await req.json().catch(() => ({}));
    const submittedAnswers = body?.answers || {};
    const clientReason = (body?.reason as SubmitReason) || "manual";

    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const attemptDoc = await attemptRef.get();

    if (!attemptDoc.exists) {
      return apiError("Attempt not found", 404);
    }

    const attempt = attemptDoc.data() as Attempt;

    if (attempt.uid !== user.uid) {
      return apiError("Unauthorized to submit this attempt", 403);
    }

    // Idempotency: if already submitted, return success without regrading
    if (attempt.status === "submitted" || attempt.status === "auto_submitted" || attempt.status === "terminated_by_proctor") {
      const resp: SubmitResponse = { submitted: true };
      return apiSuccess(resp);
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Final heartbeat check per second-phone proctor brief
    if (attempt.phone?.paired && attempt.phone?.lastBeatAt) {
      const silenceMs = now.getTime() - attempt.phone.lastBeatAt;
      if (silenceMs > 150_000) {
        try {
          const { applyPhoneEvent } = await import("@/lib/phoneStrikes");
          await applyPhoneEvent(attemptId, "HEARTBEAT_LOST", { durationMs: silenceMs });
        } catch {}
      }
    }

    // Fetch answer key for this test (cached in memory for high-concurrency submission bursts)
    const answerKeyData = await getOrSetCache<AnswerKeysDoc>(
      `answerKeys_${attempt.testId}`,
      60 * 1000,
      async () => {
        const doc = await adminDb
          .collection("answerKeys")
          .doc(attempt.testId)
          .get();
        return (doc.data() as AnswerKeysDoc) || { answers: {} };
      }
    );

    const answerKey = answerKeyData?.answers || {};

    // Use submitted answers if provided by candidate; fallback to last autosaved answers
    let finalAnswers: Record<string, number>;
    if (body && typeof body.answers === "object" && body.answers !== null) {
      finalAnswers = {};
      for (const [qId, val] of Object.entries(body.answers)) {
        if (typeof val === "number" && val >= 0 && val <= 3) {
          finalAnswers[qId] = val;
        }
      }
    } else {
      finalAnswers = attempt.answers || {};
    }

    const { score, total } = gradeAnswers(finalAnswers, answerKey);
    const startedMs = new Date(attempt.startedAt).getTime();
    const rawDiffSec = isNaN(startedMs)
      ? 0
      : Math.round((now.getTime() - startedMs) / 1000);
    const timeTakenSec = isNaN(rawDiffSec) ? 0 : Math.max(0, rawDiffSec);

    const finalStatus =
      clientReason === "manual"
        ? "submitted"
        : clientReason === "terminated_by_proctor"
        ? "terminated_by_proctor"
        : "auto_submitted";

    await attemptRef.update({
      status: finalStatus,
      submitReason: clientReason,
      answers: finalAnswers,
      score,
      total,
      timeTakenSec,
      submittedAt: nowIso,
    });

    // Per Phase 2 specification: return only { submitted: true } (Phase 3 handles results)
    const response: SubmitResponse = {
      submitted: true,
    };

    return apiSuccess(response);
  } catch (error: any) {
    return apiError(error?.message || "Failed to submit test", 500);
  }
}
