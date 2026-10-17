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
      return apiError("Cannot activate an archived series", 400);
    }

    // Check if another series is active
    const activeSnapshot = await adminDb
      .collection("series")
      .where("status", "==", "active")
      .get();

    const otherActive = activeSnapshot.docs.find((doc) => doc.id !== seriesId);
    if (otherActive) {
      const otherData = otherActive.data();
      return apiError(
        `Another series ("${otherData.title}") is currently active. Archive or change it before activating this series.`,
        400
      );
    }

    await seriesRef.update({
      status: "active",
    });

    invalidateCache("active_series_and_tests");
    invalidateCache(`series_${seriesId}`);

    const updatedDoc = await seriesRef.get();
    return apiSuccess({
      series: { id: updatedDoc.id, ...updatedDoc.data() },
      message: "Series activated successfully",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to activate series", 500);
  }
}
