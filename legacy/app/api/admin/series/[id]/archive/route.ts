import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { invalidateCache } from "@/lib/cache";
import { Series } from "@/types";

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
      return apiError("Series is already archived", 400);
    }

    const nowIso = new Date().toISOString();
    await seriesRef.update({
      status: "archived",
      archivedAt: nowIso,
    });

    invalidateCache("active_series_and_tests");
    invalidateCache(`series_${seriesId}`);

    const updatedDoc = await seriesRef.get();
    return apiSuccess({
      series: { id: updatedDoc.id, ...updatedDoc.data() },
      message: "Series archived successfully",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to archive series", 500);
  }
}
