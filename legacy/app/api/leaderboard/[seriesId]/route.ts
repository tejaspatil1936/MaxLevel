import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { Series, LeaderboardDoc } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ seriesId: string }> }
) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;
    let { seriesId } = await context.params;

    // Resolve "active" keyword
    if (seriesId === "active") {
      const activeSeriesSnap = await adminDb
        .collection("series")
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (activeSeriesSnap.empty) {
        return apiError("No active test series found", 404);
      }
      seriesId = activeSeriesSnap.docs[0].id;
    }

    // Fetch the target series
    const seriesDoc = await adminDb.collection("series").doc(seriesId).get();
    if (!seriesDoc.exists) {
      return apiError("Series not found", 404);
    }
    const series = { id: seriesDoc.id, ...seriesDoc.data() } as Series;

    // Visibility check
    if (!series.leaderboardVisible && user.role !== "admin") {
      return apiError("Leaderboard is not released yet.", 403);
    }

    // Fetch leaderboard doc
    const leaderboardDoc = await adminDb.collection("leaderboards").doc(seriesId).get();
    if (!leaderboardDoc.exists) {
      return apiError("Leaderboard has not been generated yet for this series.", 404);
    }
    const leaderboard = leaderboardDoc.data() as LeaderboardDoc;

    // Fetch all available series with released leaderboards (for switching / past series)
    const allSeriesSnap = await adminDb.collection("series").get();
    const availableSeries: Array<{ id: string; title: string; status: string; archivedAt?: string | null }> = [];

    for (const doc of allSeriesSnap.docs) {
      const s = doc.data() as Series;
      if (user.role === "admin" || s.leaderboardVisible) {
        availableSeries.push({
          id: doc.id,
          title: s.title,
          status: s.status,
          archivedAt: s.archivedAt || null,
        });
      }
    }

    // Fetch tests for this series to provide day information
    const testsSnap = await adminDb
      .collection("tests")
      .where("seriesId", "==", seriesId)
      .get();
    const tests = testsSnap.docs
      .map((d) => ({
        id: d.id,
        day: (d.data().day as number) || 1,
        title: (d.data().title as string) || "",
        company: (d.data().company as string) || "",
      }))
      .sort((a, b) => a.day - b.day);

    return apiSuccess({
      series: {
        id: series.id,
        title: series.title,
        status: series.status,
      },
      tests,
      leaderboard,
      availableSeries,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch leaderboard", 500);
  }
}
