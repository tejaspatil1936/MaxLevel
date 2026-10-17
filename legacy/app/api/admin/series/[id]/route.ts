import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { SeriesPatchSchema } from "@/lib/validate";
import { Series, Test } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { id: seriesId } = await context.params;

    const seriesDoc = await adminDb.collection("series").doc(seriesId).get();
    if (!seriesDoc.exists) {
      return apiError("Series not found", 404);
    }

    const seriesData = { id: seriesDoc.id, ...seriesDoc.data() } as Series;

    // Fetch tests
    const testsSnapshot = await adminDb
      .collection("tests")
      .where("seriesId", "==", seriesId)
      .get();

    const tests: Test[] = testsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Test, "id">),
    }));

    tests.sort((a, b) => a.day - b.day);

    return apiSuccess({ series: seriesData, tests });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch series", 500);
  }
}

export async function PATCH(
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
      return apiError("Archived series cannot be modified", 400);
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = SeriesPatchSchema.safeParse(body);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return apiError(`Validation failed: ${issue.message}`, 400);
    }

    const updates = parseResult.data;
    await seriesRef.update(updates);

    const updatedDoc = await seriesRef.get();
    return apiSuccess({
      series: { id: updatedDoc.id, ...updatedDoc.data() },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to update series", 500);
  }
}
