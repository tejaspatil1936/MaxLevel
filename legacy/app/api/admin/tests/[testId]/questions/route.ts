import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { validateQuestionUpload } from "@/lib/validate";
import { invalidateCache } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ testId: string }> }
) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { testId } = await context.params;

    const testQuestionsDoc = await adminDb.collection("testQuestions").doc(testId).get();
    const answerKeysDoc = await adminDb.collection("answerKeys").doc(testId).get();

    if (!testQuestionsDoc.exists) {
      return apiSuccess({
        hasQuestions: false,
        questionCount: 0,
        questions: [],
      });
    }

    const questionsData = testQuestionsDoc.data()?.questions || [];
    const answersData = answerKeysDoc.data()?.answers || {};

    return apiSuccess({
      hasQuestions: true,
      questionCount: questionsData.length,
      questions: questionsData.map((q: any) => ({
        ...q,
        correctIndex: answersData[q.id] ?? null,
      })),
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch questions", 500);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ testId: string }> }
) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { testId } = await context.params;
    const testRef = adminDb.collection("tests").doc(testId);
    const testDoc = await testRef.get();

    if (!testDoc.exists) {
      return apiError("Test not found", 404);
    }

    let parsedJson: any = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return apiError("No file uploaded in form data", 400);
      }
      if (file.size > 5 * 1024 * 1024) {
        return apiError("Uploaded questions file exceeds 5MB limit", 400);
      }
      const text = await file.text();
      try {
        parsedJson = JSON.parse(text);
      } catch {
        return apiError("Uploaded file is not valid JSON", 400);
      }
    } else {
      parsedJson = await req.json().catch(() => null);
      if (!parsedJson) {
        return apiError("Invalid JSON body", 400);
      }
    }

    // Strict validation
    const validation = validateQuestionUpload(parsedJson);
    if (!validation.valid || !validation.data) {
      return apiError(
        validation.error || "Question validation failed",
        400
      );
    }

    const { cleanQuestions, answerKey, explanations } = validation.data;

    // Batch write to Firestore:
    // 1. testQuestions/{testId} -> questions without correctIndex
    // 2. answerKeys/{testId} -> answers and explanations
    // 3. tests/{testId} -> questionCount, hasQuestions: true
    const batch = adminDb.batch();

    const testQuestionsRef = adminDb.collection("testQuestions").doc(testId);
    batch.set(testQuestionsRef, {
      questions: cleanQuestions,
      updatedAt: new Date().toISOString(),
    });

    const answerKeysRef = adminDb.collection("answerKeys").doc(testId);
    batch.set(answerKeysRef, {
      answers: answerKey,
      explanations,
      updatedAt: new Date().toISOString(),
    });

    batch.update(testRef, {
      questionCount: cleanQuestions.length,
      hasQuestions: true,
    });

    await batch.commit();

    // Invalidate cached question and test data immediately
    invalidateCache(`test_${testId}`);
    invalidateCache(`testQuestions_${testId}`);
    invalidateCache(`testQuestionsList_${testId}`);
    invalidateCache(`answerKeys_${testId}`);
    invalidateCache("active_series_and_tests");

    return apiSuccess({
      message: `Successfully uploaded ${cleanQuestions.length} questions`,
      questionCount: cleanQuestions.length,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to upload questions", 500);
  }
}
