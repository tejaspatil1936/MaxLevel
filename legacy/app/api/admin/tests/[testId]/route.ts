import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { invalidateCache } from "@/lib/cache";
import { TestUpdateSchema } from "@/lib/validate";
import { Test } from "@/types";

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
    const testDoc = await adminDb.collection("tests").doc(testId).get();

    if (!testDoc.exists) {
      return apiError("Test not found", 404);
    }

    return apiSuccess({
      test: { id: testDoc.id, ...testDoc.data() },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch test", 500);
  }
}

export async function PUT(
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

    const body = await req.json().catch(() => ({}));
    const parseResult = TestUpdateSchema.safeParse(body);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return apiError(`Validation failed: ${issue.message}`, 400);
    }

    const updates = parseResult.data;
    await testRef.update(updates);

    invalidateCache(`test_${testId}`);
    invalidateCache("active_series_and_tests");

    const updatedDoc = await testRef.get();
    return apiSuccess({
      test: { id: updatedDoc.id, ...updatedDoc.data() },
      message: "Test updated successfully",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to update test", 500);
  }
}

export async function DELETE(
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

    const batch = adminDb.batch();
    batch.delete(testRef);
    batch.delete(adminDb.collection("testQuestions").doc(testId));
    batch.delete(adminDb.collection("answerKeys").doc(testId));

    // Also delete any existing attempts for this test
    const attemptsSnap = await adminDb
      .collection("attempts")
      .where("testId", "==", testId)
      .get();

    attemptsSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    invalidateCache(`test_${testId}`);
    invalidateCache(`testQuestions_${testId}`);
    invalidateCache(`testQuestionsList_${testId}`);
    invalidateCache(`answerKeys_${testId}`);
    invalidateCache("active_series_and_tests");

    return apiSuccess({
      message: "Assessment and associated questions deleted successfully",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to delete test", 500);
  }
}
