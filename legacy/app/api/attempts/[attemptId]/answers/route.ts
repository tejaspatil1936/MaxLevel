import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { Attempt } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
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

    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const attemptDoc = await attemptRef.get();

    if (!attemptDoc.exists) {
      return apiError("Attempt not found", 404);
    }

    const attempt = attemptDoc.data() as Attempt;

    if (attempt.uid !== user.uid) {
      return apiError("Unauthorized to update this attempt", 403);
    }

    if (attempt.status !== "in_progress") {
      return apiError("Cannot autosave: attempt has already been finalized", 400);
    }

    const now = new Date();
    const deadline = new Date(attempt.deadlineAt);
    const graceDeadline = new Date(deadline.getTime() + 30 * 1000);

    if (now > graceDeadline) {
      return apiError("Test deadline has passed. Autosave rejected.", 403);
    }

    const body = await req.json().catch(() => ({}));
    const answers = body?.answers;

    if (!answers || typeof answers !== "object") {
      return apiError("Invalid answers format", 400);
    }

    // Filter to valid numbers
    const cleanAnswers: Record<string, number> = {};
    for (const [qId, val] of Object.entries(answers)) {
      if (typeof val === "number" && val >= 0 && val <= 3) {
        cleanAnswers[qId] = val;
      }
    }

    await attemptRef.update({
      answers: cleanAnswers,
      lastAutosaveAt: now.toISOString(),
    });

    return apiSuccess({ saved: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to autosave answers", 500);
  }
}
