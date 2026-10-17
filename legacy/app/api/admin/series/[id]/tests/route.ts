import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { TestCreateSchema } from "@/lib/validate";
import { Series, Test } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { id: seriesId } = await context.params;

    const seriesRef = adminDb.collection("series").doc(seriesId);
    const seriesDoc = await seriesRef.get();

    if (!seriesDoc.exists) {
      return apiError("Series not found", 404);
    }

    const seriesData = seriesDoc.data() as Series;
    if (seriesData.status === "archived") {
      return apiError("Cannot add tests to an archived series", 400);
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = TestCreateSchema.safeParse(body);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return apiError(`Validation failed: ${issue.message}`, 400);
    }

    const data = parseResult.data;
    const testRef = adminDb.collection("tests").doc();

    const newTest: Omit<Test, "id"> = {
      seriesId,
      day: data.day,
      title: data.title,
      company: data.company,
      date: data.date,
      window: data.window || null,
      durationMin: data.durationMin || null,
      questionCount: 0,
      resultsVisible: data.resultsVisible ?? null,
      hasQuestions: false,
    };

    await testRef.set(newTest);

    return apiSuccess({
      test: { id: testRef.id, ...newTest },
      message: `Day ${data.day} assessment created successfully`,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to create assessment", 500);
  }
}
