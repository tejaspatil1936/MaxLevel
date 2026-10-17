import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { gradeAnswers } from "@/lib/grade";
import {
  Attempt,
  Series,
  ViolationType,
  ViolationResponse,
  AnswerKeysDoc,
  SubmitReason,
} from "@/types";

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
    const type = body?.type as ViolationType;
    const meta = body?.meta || {};
    const requestAnswers = body?.answers;

    if (!type) {
      return apiError("Missing violation type", 400);
    }

    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const now = new Date();
    const nowIso = now.toISOString();

    const result = await adminDb.runTransaction(async (transaction) => {
      const attemptDoc = await transaction.get(attemptRef);
      if (!attemptDoc.exists) {
        throw new Error("Attempt not found");
      }

      const attempt = attemptDoc.data() as Attempt;

      if (attempt.uid !== user.uid) {
        throw new Error("Unauthorized to access this attempt");
      }

      // If already finalized, return current status
      if (attempt.status !== "in_progress") {
        return {
          strikes: attempt.strikes,
          max: 3,
          autoSubmit: true,
          submitReason: attempt.submitReason,
          submitReasonDetail: attempt.submitReasonDetail,
        };
      }

      // Read series config for maxStrikes and devtoolsOpenPolicy
      const seriesDoc = await transaction.get(
        adminDb.collection("series").doc(attempt.seriesId)
      );
      const seriesData = seriesDoc.data() as Series;
      const maxStrikes = seriesData?.maxStrikes || 3;
      const devtoolsPolicy = seriesData?.devtoolsOpenPolicy || "strike";

      let strikeIncrement = 0;
      let shouldInstantSubmit = false;
      let reason: SubmitReason = null;
      let violationLabel = "";

      if (type === "devtools_shortcut") {
        shouldInstantSubmit = true;
        reason = "devtools";
        violationLabel = "Developer tools keyboard shortcut detected";
      } else if (type === "devtools_open") {
        if (devtoolsPolicy === "submit") {
          shouldInstantSubmit = true;
          reason = "devtools";
          violationLabel = "Developer tools inspector panel opened";
        } else {
          strikeIncrement = 1;
          reason = "devtools";
          violationLabel = "Developer tools inspector panel opened";
        }
      } else if (type === "tab_switch") {
        strikeIncrement = 1;
        violationLabel = "Exited exam tab or lost window focus";
      } else if (type === "fullscreen_exit") {
        strikeIncrement = 1;
        violationLabel = "Exited fullscreen exam mode";
      } else if (type === "copy") {
        strikeIncrement = 1;
        violationLabel = "Clipboard copy operation";
      } else if (type === "cut") {
        strikeIncrement = 1;
        violationLabel = "Clipboard cut operation";
      } else if (type === "paste") {
        strikeIncrement = 1;
        violationLabel = "Clipboard paste operation";
      } else if (type === "camera_no_face") {
        const cameraApplies = seriesData?.cameraStrikes !== false;
        strikeIncrement = cameraApplies ? 1 : 0;
        if (strikeIncrement > 0) {
          reason = "camera";
        }
        violationLabel = "No face detected in camera frame";
      } else if (type === "camera_multiple_faces") {
        const cameraApplies = seriesData?.cameraStrikes !== false;
        strikeIncrement = cameraApplies ? 1 : 0;
        if (strikeIncrement > 0) {
          reason = "camera";
        }
        violationLabel = "Multiple faces detected in camera feed";
      } else if (type === "camera_lost") {
        const cameraApplies = seriesData?.cameraStrikes !== false;
        strikeIncrement = cameraApplies ? 1 : 0;
        if (strikeIncrement > 0) {
          reason = "camera";
        }
        violationLabel = "Camera video feed disconnected";
      } else if (type === "camera_phone_detected") {
        const cameraApplies = seriesData?.cameraStrikes !== false;
        strikeIncrement = cameraApplies ? 1 : 0;
        if (strikeIncrement > 0) {
          reason = "camera";
        }
        violationLabel = "Unauthorized mobile phone detected in front camera";
      } else if (type === "multiple_screens") {
        strikeIncrement = 1;
        violationLabel = "Multiple monitors or extended display detected";
      } else if (type === "reload") {
        strikeIncrement = 0;
        violationLabel = "Page reload detected";
      }

      const newStrikes = attempt.strikes + strikeIncrement;
      let autoSubmit = shouldInstantSubmit;

      if (!autoSubmit && newStrikes >= maxStrikes) {
        autoSubmit = true;
        if (!reason) {
          reason = "strikes";
        }
      }

      let submitReasonDetail = "";
      if (autoSubmit) {
        if (shouldInstantSubmit) {
          submitReasonDetail = violationLabel;
        } else {
          submitReasonDetail = `Exceeded maximum allowed proctor strikes (${violationLabel})`;
        }
      }

      // Append event (capped at 100)
      const existingEvents = attempt.events || [];
      const updatedEvents = [
        ...existingEvents,
        {
          type,
          at: nowIso,
          meta: { ...meta, strikesAfter: newStrikes },
        },
      ].slice(-100);

      const updates: Partial<Attempt> = {
        strikes: newStrikes,
        events: updatedEvents,
      };

      if (autoSubmit) {
        // Read answer keys to grade attempt
        const answerKeyDoc = await transaction.get(
          adminDb.collection("answerKeys").doc(attempt.testId)
        );
        const answerKey =
          (answerKeyDoc.data() as AnswerKeysDoc)?.answers || {};

        // Grade using request body answers merged with last autosaved answers
        const finalAnswers: Record<string, number> = {
          ...(attempt.answers || {}),
          ...(requestAnswers && typeof requestAnswers === "object"
            ? requestAnswers
            : {}),
        };

        const { score, total } = gradeAnswers(finalAnswers, answerKey);
        const startedMs = new Date(attempt.startedAt).getTime();
        const rawDiffSec = isNaN(startedMs)
          ? 0
          : Math.round((now.getTime() - startedMs) / 1000);
        const timeTakenSec = isNaN(rawDiffSec) ? 0 : Math.max(0, rawDiffSec);

        updates.status = "auto_submitted";
        updates.submitReason = reason;
        updates.submitReasonDetail = submitReasonDetail;
        updates.answers = finalAnswers;
        updates.score = score;
        updates.total = total;
        updates.timeTakenSec = timeTakenSec;
        updates.submittedAt = nowIso;
      }

      transaction.update(attemptRef, updates);

      return {
        strikes: newStrikes,
        max: maxStrikes,
        autoSubmit,
        submitReason: reason,
        submitReasonDetail,
      };
    });

    const response: ViolationResponse = result;
    return apiSuccess(response);
  } catch (error: any) {
    return apiError(error?.message || "Failed to process violation", 400);
  }
}
