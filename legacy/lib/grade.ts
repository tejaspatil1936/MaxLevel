import { adminDb } from "./firebase-admin";
import { Attempt, AnswerKeysDoc } from "@/types";

/**
 * Pure grading function: compares submitted answers against the answer key.
 * 1 point per correct match.
 */
export function gradeAnswers(
  userAnswers: Record<string, number> = {},
  answerKey: Record<string, number> = {}
): { score: number; total: number } {
  const questionIds = Object.keys(answerKey);
  const total = questionIds.length;
  let score = 0;

  for (const qId of questionIds) {
    const expected = answerKey[qId];
    const given = userAnswers[qId];
    if (given !== undefined && given !== null && Number(given) === Number(expected)) {
      score++;
    }
  }

  return { score, total };
}

/**
 * Finalizes in_progress attempts that passed deadlineAt + 30s.
 * Idempotent, safe to run lazily on read operations.
 */
export async function finalizeExpiredAttempts(testId: string): Promise<number> {
  const now = new Date();
  const snapshot = await adminDb
    .collection("attempts")
    .where("testId", "==", testId)
    .where("status", "==", "in_progress")
    .get();

  if (snapshot.empty) {
    return 0;
  }

  // Fetch answer key once
  const answerKeyDoc = await adminDb.collection("answerKeys").doc(testId).get();
  const answerKeyData = (answerKeyDoc.data() as AnswerKeysDoc)?.answers || {};

  let finalizedCount = 0;
  const batch = adminDb.batch();

  for (const doc of snapshot.docs) {
    const attempt = doc.data() as Attempt;
    const deadline = new Date(attempt.deadlineAt);
    const graceDeadline = new Date(deadline.getTime() + 30 * 1000);

    // If past deadline + 30s grace period, finalize it
    if (now > graceDeadline) {
      const { score, total } = gradeAnswers(attempt.answers || {}, answerKeyData);
      const startedMs = new Date(attempt.startedAt).getTime();
      const deadlineMs = deadline.getTime();
      const rawSec =
        isNaN(startedMs) || isNaN(deadlineMs)
          ? 0
          : Math.round((deadlineMs - startedMs) / 1000);
      const timeTakenSec = isNaN(rawSec) ? 0 : Math.max(0, rawSec);

      batch.update(doc.ref, {
        status: "auto_submitted",
        submitReason: "expired",
        score,
        total,
        timeTakenSec,
        submittedAt: deadline.toISOString(),
      });
      finalizedCount++;
    }
  }

  if (finalizedCount > 0) {
    await batch.commit();
  }

  return finalizedCount;
}

/**
 * Finalizes a single attempt if it is in_progress and passed deadlineAt + 30s.
 * Highly optimized for individual student result retrieval without scanning the collection.
 */
export async function finalizeSingleAttemptIfExpired(
  attemptRef: FirebaseFirestore.DocumentReference,
  attempt: Attempt
): Promise<Attempt> {
  if (attempt.status !== "in_progress") {
    return attempt;
  }

  const now = new Date();
  const deadline = new Date(attempt.deadlineAt);
  const graceDeadline = new Date(deadline.getTime() + 30 * 1000);

  if (now > graceDeadline) {
    const answerKeyDoc = await adminDb.collection("answerKeys").doc(attempt.testId).get();
    const answerKeyData = (answerKeyDoc.data() as AnswerKeysDoc)?.answers || {};
    const { score, total } = gradeAnswers(attempt.answers || {}, answerKeyData);
    const startedMs = new Date(attempt.startedAt).getTime();
    const deadlineMs = deadline.getTime();
    const rawSec =
      isNaN(startedMs) || isNaN(deadlineMs)
        ? 0
        : Math.round((deadlineMs - startedMs) / 1000);
    const timeTakenSec = isNaN(rawSec) ? 0 : Math.max(0, rawSec);

    const updateData = {
      status: "auto_submitted" as const,
      submitReason: "expired" as const,
      score,
      total,
      timeTakenSec,
      submittedAt: deadline.toISOString(),
    };

    await attemptRef.update(updateData);
    return {
      ...attempt,
      ...updateData,
    };
  }

  return attempt;
}

