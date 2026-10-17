import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { computeTestState, isTestResultsVisible } from "@/lib/time";
import { getOrSetCache } from "@/lib/cache";
import { Series, Test, StudentTestView } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    // Fetch active series and its tests with a 15-second cache to absorb concurrent landing traffic
    const { seriesData, rawTests } = await getOrSetCache<{
      seriesData: Series | null;
      rawTests: Test[];
    }>("active_series_and_tests", 15 * 1000, async () => {
      const seriesSnapshot = await adminDb
        .collection("series")
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (seriesSnapshot.empty) {
        return { seriesData: null, rawTests: [] };
      }

      const seriesDoc = seriesSnapshot.docs[0];
      const sData = { id: seriesDoc.id, ...seriesDoc.data() } as Series;

      const testsSnapshot = await adminDb
        .collection("tests")
        .where("seriesId", "==", sData.id)
        .get();

      const rTests: Test[] = testsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Test, "id">),
      }));

      rTests.sort((a, b) => a.day - b.day);

      return { seriesData: sData, rawTests: rTests };
    });

    if (!seriesData) {
      return apiSuccess({
        series: null,
        tests: [],
      });
    }

    // Fetch attempts for the current user for each test
    const studentTests: StudentTestView[] = await Promise.all(
      rawTests.map(async (test) => {
        const attemptId = `${test.id}_${user.uid}`;
        const attemptDoc = await adminDb.collection("attempts").doc(attemptId).get();
        const attemptData = attemptDoc.exists
          ? (attemptDoc.data() as { status: "in_progress" | "submitted" | "auto_submitted" | "terminated_by_proctor" })
          : null;

        const effectiveWindow = test.window || seriesData.window;
        const effectiveDurationMin = test.durationMin ?? seriesData.durationMin;
        const effectiveResultsVisible = isTestResultsVisible(test, seriesData);
        const effectiveSecondaryCameraRequired =
          test.secondaryCameraRequired === false
            ? false
            : test.secondaryCameraRequired === true
            ? true
            : seriesData.secondaryCameraRequired === false
            ? false
            : true;

        const state = computeTestState(test, seriesData, attemptData);

        return {
          ...test,
          effectiveWindow,
          effectiveDurationMin,
          effectiveResultsVisible,
          effectiveSecondaryCameraRequired,
          state,
          userAttempt: attemptData ? { id: attemptId, status: attemptData.status } : null,
        };
      })
    );

    return apiSuccess({
      series: seriesData,
      tests: studentTests,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch active series", 500);
  }
}
