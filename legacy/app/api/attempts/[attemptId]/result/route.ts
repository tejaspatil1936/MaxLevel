import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { finalizeSingleAttemptIfExpired } from "@/lib/grade";
import { getOrSetCache } from "@/lib/cache";
import { isTestResultsVisible } from "@/lib/time";
import {
  Attempt,
  Series,
  Test,
  TestQuestionsDoc,
  AnswerKeysDoc,
  AttemptResultResponse,
  QuestionReviewItem,
} from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
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
    let attemptDoc = await attemptRef.get();

    if (!attemptDoc.exists) {
      return apiError("Attempt not found", 404);
    }

    let attempt = attemptDoc.data() as Attempt;

    if (attempt.uid !== user.uid && user.role !== "admin") {
      return apiError("Unauthorized to view this attempt result", 403);
    }

    // Only finalize this specific attempt if it is in_progress and past grace deadline
    if (attempt.status === "in_progress") {
      attempt = await finalizeSingleAttemptIfExpired(attemptRef, attempt);
    }

    if (attempt.status === "in_progress") {
      return apiError("Attempt is still in progress", 400);
    }

    // Check visibility settings (Cached to avoid thousands of concurrent reads)
    const [testData, seriesData] = await Promise.all([
      getOrSetCache<Test>(`test_${attempt.testId}`, 30 * 1000, async () => {
        const doc = await adminDb.collection("tests").doc(attempt.testId).get();
        return { id: doc.id, ...doc.data() } as Test;
      }),
      getOrSetCache<Series>(`series_${attempt.seriesId}`, 30 * 1000, async () => {
        const doc = await adminDb.collection("series").doc(attempt.seriesId).get();
        return { id: doc.id, ...doc.data() } as Series;
      }),
    ]);

    const isVisible = testData ? isTestResultsVisible(testData, seriesData) : false;

    if (!isVisible && user.role !== "admin") {
      return apiError("Results are not released yet.", 403);
    }

    // Fetch questions and answer keys for review (Cached in memory across all students)
    const [questionsDocData, answerKeysDocData] = await Promise.all([
      getOrSetCache<TestQuestionsDoc>(`testQuestions_${attempt.testId}`, 60 * 1000, async () => {
        const doc = await adminDb.collection("testQuestions").doc(attempt.testId).get();
        return (doc.data() as TestQuestionsDoc) || { questions: [] };
      }),
      getOrSetCache<AnswerKeysDoc>(`answerKeys_${attempt.testId}`, 60 * 1000, async () => {
        const doc = await adminDb.collection("answerKeys").doc(attempt.testId).get();
        return (doc.data() as AnswerKeysDoc) || { answers: {}, explanations: {} };
      }),
    ]);

    const questionsData = questionsDocData?.questions || [];
    const answerKeysData = answerKeysDocData?.answers || {};
    const explanationsData = answerKeysDocData?.explanations || {};

    const reviewQuestions: QuestionReviewItem[] = questionsData.map((q) => {
      const userAns = attempt.answers?.[q.id] !== undefined ? attempt.answers[q.id] : null;
      const correctAns = answerKeysData[q.id] !== undefined ? answerKeysData[q.id] : 0;
      const explanation = explanationsData[q.id] || "";

      return {
        id: q.id,
        text: q.text,
        options: q.options,
        userAnswer: userAns,
        correctAnswer: correctAns,
        explanation,
        topic: q.topic,
      };
    });

    const resultData: AttemptResultResponse = {
      score: attempt.score,
      total: attempt.total,
      timeTakenSec: attempt.timeTakenSec,
      submittedAt: attempt.submittedAt || attempt.deadlineAt,
      submitReason: attempt.submitReason,
      submitReasonDetail: attempt.submitReasonDetail,
      questions: reviewQuestions,
    };

    return apiSuccess(resultData);
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch attempt result", 500);
  }
}
