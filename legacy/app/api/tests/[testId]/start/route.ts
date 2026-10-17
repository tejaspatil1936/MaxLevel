import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { computeTestState } from "@/lib/time";
import { getOrSetCache } from "@/lib/cache";
import { Attempt, Series, Test, TestQuestionsDoc, StartTestResponse } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ testId: string }> }
) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;
    const { testId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const clientMeta = body?.meta || {};

    // Fetch test doc (cached in memory for high-concurrency start spikes)
    const test = await getOrSetCache<Test | null>(`test_${testId}`, 30 * 1000, async () => {
      const doc = await adminDb.collection("tests").doc(testId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Test;
    });

    if (!test) {
      return apiError("Test not found", 404);
    }

    // Fetch series doc (cached in memory)
    const series = await getOrSetCache<Series | null>(`series_${test.seriesId}`, 30 * 1000, async () => {
      const doc = await adminDb.collection("series").doc(test.seriesId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Series;
    });

    if (!series) {
      return apiError("Series not found", 404);
    }

    if (series.status !== "active") {
      return apiError("This test series is not currently active", 403);
    }

    if (!test.hasQuestions) {
      return apiError("Test questions are not uploaded yet. Contact admin.", 400);
    }

    const attemptId = `${testId}_${user.uid}`;
    const attemptRef = adminDb.collection("attempts").doc(attemptId);
    const now = new Date();
    const serverNow = now.toISOString();

    const durationMin = test.durationMin ?? series.durationMin;

    // Fetch questions doc (questions only, never answer key, cached across all students)
    const questionsData = await getOrSetCache<any[]>(`testQuestionsList_${testId}`, 60 * 1000, async () => {
      const doc = await adminDb.collection("testQuestions").doc(testId).get();
      if (!doc.exists) return [];
      return (doc.data() as TestQuestionsDoc)?.questions || [];
    });

    if (!questionsData || questionsData.length === 0) {
      return apiError("Test questions not found", 404);
    }

    // 1. Check if candidate already has an attempt (Reconnect path)
    // Per system design: once started inside the window, the student's deadline is startedAt + durationMin,
    // and is NOT cut short by the window closing. Reconnects must remain allowed until deadlineAt + 30s.
    const existingDoc = await attemptRef.get();
    if (existingDoc.exists) {
      const existingAttempt = existingDoc.data() as Attempt;

      if (existingAttempt.status === "in_progress") {
        const deadline = new Date(existingAttempt.deadlineAt);
        const graceDeadline = new Date(deadline.getTime() + 30 * 1000);

        if (now <= graceDeadline) {
          return apiSuccess<StartTestResponse>({
            attemptId,
            questions: questionsData,
            deadlineAt: existingAttempt.deadlineAt,
            serverNow,
            answers: existingAttempt.answers || {},
            isReconnect: true,
          });
        } else {
          // Attempt deadline expired
          await attemptRef.update({
            status: "auto_submitted",
            submitReason: "expired",
            submittedAt: existingAttempt.deadlineAt,
          });
          return apiError("Your test attempt duration has expired.", 400);
        }
      } else if (
        existingAttempt.status === "submitted" ||
        existingAttempt.status === "auto_submitted" ||
        existingAttempt.status === "terminated_by_proctor"
      ) {
        return apiError("You have already submitted an attempt for this test", 400);
      }
    }

    // 2. Candidate is starting for the first time: must be within the daily start window
    const testState = computeTestState(test, series, null);
    if (testState !== "open") {
      return apiError(
        testState === "upcoming"
          ? "The test window has not opened yet."
          : "The test window for this assessment has closed.",
        403
      );
    }

    const isSecondaryCameraRequired =
      test.secondaryCameraRequired === false
        ? false
        : test.secondaryCameraRequired === true
        ? true
        : series.secondaryCameraRequired === false
        ? false
        : true;

    // 3. Create new attempt inside transaction to prevent double-click race conditions
    const attemptResult = await adminDb.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(attemptRef);
      const txAttempt = txDoc.exists ? (txDoc.data() as Attempt) : null;
      if (
        txAttempt &&
        (txAttempt.status === "submitted" ||
          txAttempt.status === "auto_submitted" ||
          txAttempt.status === "terminated_by_proctor")
      ) {
        throw new Error("You have already completed and submitted this assessment.");
      }
      if (txAttempt && txAttempt.status === "in_progress") {
        return {
          attemptId,
          deadlineAt: txAttempt.deadlineAt,
          answers: txAttempt.answers || {},
          isReconnect: true,
        };
      }

      // Hard-block start if secondary camera is required but phone is not actively monitoring
      if (isSecondaryCameraRequired && (!txAttempt?.phone?.paired || !txAttempt?.phone?.active)) {
        throw new Error("Secondary phone proctor must be actively monitoring before starting the assessment.");
      }

      // Create new attempt preserving phone pairing if already paired
      const deadlineAt = new Date(now.getTime() + durationMin * 60 * 1000).toISOString();
      const newAttempt: Attempt = {
        id: attemptId,
        uid: user.uid,
        seriesId: test.seriesId,
        testId: test.id,
        status: "in_progress",
        submitReason: null,
        startedAt: serverNow,
        deadlineAt,
        answers: {},
        score: 0,
        total: questionsData.length,
        timeTakenSec: 0,
        strikes: 0,
        events: [
          { type: "start", at: serverNow, meta: clientMeta },
          ...(clientMeta.multiScreen
            ? [
                {
                  type: "multiple_screens",
                  at: serverNow,
                  meta: {
                    screenCount: clientMeta.screenCount || 2,
                    flaggedAtRules: true,
                  },
                },
              ]
            : []),
        ],
        submittedAt: null,
        phone: {
          paired: Boolean(txAttempt?.phone?.paired),
          active: Boolean(txAttempt?.phone?.active),
          strikes: 0,
          last: {},
          lastBeatAt: Date.now(),
        },
      };

      transaction.set(attemptRef, newAttempt, { merge: true });
      return {
        attemptId,
        deadlineAt,
        answers: {},
        isReconnect: false,
      };
    });

    const responseData: StartTestResponse = {
      attemptId: attemptResult.attemptId,
      questions: questionsData,
      deadlineAt: attemptResult.deadlineAt,
      serverNow,
      answers: attemptResult.answers || {},
      isReconnect: attemptResult.isReconnect,
      day: test.day,
      testTitle: test.title,
      company: test.company,
    };

    return apiSuccess(responseData);
  } catch (error: any) {
    return apiError(error?.message || "Failed to start test", 400);
  }
}
