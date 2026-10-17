import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { finalizeExpiredAttempts } from "@/lib/grade";
import { Attempt, Series, Test, UserProfile, LeaderboardRow, LeaderboardDoc } from "@/types";

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

    // Check series exists
    const seriesDoc = await adminDb.collection("series").doc(seriesId).get();
    if (!seriesDoc.exists) {
      return apiError("Series not found", 404);
    }

    // Fetch tests for this series (single-field query, no composite index needed)
    const testsSnapshot = await adminDb
      .collection("tests")
      .where("seriesId", "==", seriesId)
      .get();

    if (testsSnapshot.empty) {
      return apiError("No tests found for this series", 400);
    }

    const tests = testsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Test, "id">),
    }));

    // Finalize expired attempts for all tests in the series
    await Promise.all(tests.map((t) => finalizeExpiredAttempts(t.id)));

    // Fetch all attempts for this series (single-field query, no composite index needed)
    const attemptsSnapshot = await adminDb
      .collection("attempts")
      .where("seriesId", "==", seriesId)
      .get();

    const attempts = attemptsSnapshot.docs.map((doc) => doc.data() as Attempt);

    // Map testId to day (1..5)
    const testDayMap: Record<string, number> = {};
    for (const test of tests) {
      testDayMap[test.id] = test.day;
    }

    // Group attempts by uid
    // Include students who have at least one attempt in the series
    const studentAttemptsMap: Record<string, Record<number, Attempt>> = {};
    const uidsSet = new Set<string>();

    for (const attempt of attempts) {
      const uid = attempt.uid;
      const day = testDayMap[attempt.testId];
      if (!day) continue;

      uidsSet.add(uid);
      if (!studentAttemptsMap[uid]) {
        studentAttemptsMap[uid] = {};
      }
      studentAttemptsMap[uid][day] = attempt;
    }

    const uids = Array.from(uidsSet);
    if (uids.length === 0) {
      const emptyDoc: LeaderboardDoc = {
        generatedAt: new Date().toISOString(),
        rows: [],
      };
      await adminDb.collection("leaderboards").doc(seriesId).set(emptyDoc);
      return apiSuccess({
        generatedAt: emptyDoc.generatedAt,
        totalStudents: 0,
        message: "Leaderboard generated with 0 attempts.",
      });
    }

    // Batch fetch student profiles for name & prn (chunked into batches of 30 for document id lookups)
    const userProfiles: Record<string, { name: string; prn: string }> = {};
    const chunkSize = 30;
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);
      const userDocs = await Promise.all(
        chunk.map((uid) => adminDb.collection("users").doc(uid).get())
      );
      for (const uDoc of userDocs) {
        if (uDoc.exists) {
          const uData = uDoc.data() as UserProfile;
          userProfiles[uDoc.id] = {
            name: uData.name || "Student",
            prn: uData.prn || "—",
          };
        } else {
          userProfiles[uDoc.id] = {
            name: "Student",
            prn: "—",
          };
        }
      }
    }

    // Extract unique sorted days present in the series tests
    const days = Array.from(new Set(tests.map((t) => t.day))).sort((a, b) => a - b);

    // Construct LeaderboardRow for each student dynamically
    const rows: Omit<LeaderboardRow, "rank">[] = uids.map((uid) => {
      const dayAttempts = studentAttemptsMap[uid] || {};
      const scores: Record<string, number> = {};
      let total = 0;
      let totalTimeSec = 0;

      for (const day of days) {
        const att = dayAttempts[day];
        const dayScore = att?.score || 0;
        scores[`d${day}`] = dayScore;
        total += dayScore;
        if (att) {
          totalTimeSec += att.timeTakenSec || 0;
        }
      }

      const profile = userProfiles[uid] || { name: "Student", prn: "—" };

      return {
        uid,
        name: profile.name,
        prn: profile.prn,
        scores,
        total,
        timeSec: totalTimeSec,
      };
    });

    // Rank by total score descending, tie-break by lower total time taken
    rows.sort((a, b) => {
      const aTotal = isNaN(a.total) ? 0 : a.total;
      const bTotal = isNaN(b.total) ? 0 : b.total;
      if (bTotal !== aTotal) {
        return bTotal - aTotal;
      }
      const aTime = isNaN(a.timeSec) ? 0 : a.timeSec;
      const bTime = isNaN(b.timeSec) ? 0 : b.timeSec;
      return aTime - bTime;
    });

    // Assign ranks
    const rankedRows: LeaderboardRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      let rank = i + 1;
      if (
        i > 0 &&
        rows[i].total === rows[i - 1].total &&
        rows[i].timeSec === rows[i - 1].timeSec
      ) {
        rank = rankedRows[i - 1].rank;
      }
      rankedRows.push({
        ...rows[i],
        rank,
      });
    }

    const leaderboardDocData: LeaderboardDoc = {
      generatedAt: new Date().toISOString(),
      rows: rankedRows,
      days,
    };

    await adminDb.collection("leaderboards").doc(seriesId).set(leaderboardDocData);

    return apiSuccess({
      generatedAt: leaderboardDocData.generatedAt,
      totalStudents: rankedRows.length,
      message: `Leaderboard successfully generated with ${rankedRows.length} students ranked.`,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to generate leaderboard", 500);
  }
}
