import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { finalizeExpiredAttempts } from "@/lib/grade";
import { Attempt, UserProfile } from "@/types";

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

    // Finalize expired attempts for this test first
    await finalizeExpiredAttempts(testId);

    // Query attempts for this test (single field query, no composite index needed)
    const snapshot = await adminDb
      .collection("attempts")
      .where("testId", "==", testId)
      .get();

    const rawAttempts = snapshot.docs.map((doc) => {
      const data = doc.data() as Attempt;
      return {
        ...data,
        id: doc.id,
      };
    });

    // Fetch user details for names and PRNs
    const uids = Array.from(new Set(rawAttempts.map((a) => a.uid)));
    const userProfiles: Record<string, { name: string; prn: string; email: string }> = {};

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
            email: uData.email || "",
          };
        } else {
          userProfiles[uDoc.id] = {
            name: "Student",
            prn: "—",
            email: "",
          };
        }
      }
    }

    const enrichedAttempts = rawAttempts.map((att) => {
      const profile = userProfiles[att.uid] || { name: "Student", prn: "—", email: "" };
      return {
        id: att.id,
        uid: att.uid,
        name: profile.name,
        prn: profile.prn,
        email: profile.email,
        score: att.score ?? 0,
        total: att.total ?? 0,
        timeTakenSec: att.timeTakenSec ?? 0,
        strikes: att.strikes ?? 0,
        status: att.status,
        submitReason: att.submitReason,
        submitReasonDetail: att.submitReasonDetail || null,
        startedAt: att.startedAt,
        deadlineAt: att.deadlineAt,
        submittedAt: att.submittedAt,
        events: att.events || [],
      };
    });

    // Sort by score desc, then timeTakenSec asc
    enrichedAttempts.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.timeTakenSec - b.timeTakenSec;
    });

    return apiSuccess({ attempts: enrichedAttempts });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch test attempts", 500);
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
    const { searchParams } = new URL(req.url);
    const attemptId = searchParams.get("attemptId");
    const clearAll = searchParams.get("clearAll") === "true";

    if (attemptId) {
      await adminDb.collection("attempts").doc(attemptId).delete();
      return apiSuccess({
        message: "Attempt deleted successfully. The student can now take the test again.",
      });
    }

    if (clearAll) {
      const snapshot = await adminDb
        .collection("attempts")
        .where("testId", "==", testId)
        .get();

      if (!snapshot.empty) {
        const batch = adminDb.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }

      return apiSuccess({
        message: `Cleared all attempts for this test. Students can now take the test again.`,
      });
    }

    return apiError("Please specify attemptId or clearAll=true", 400);
  } catch (error: any) {
    return apiError(error?.message || "Failed to delete attempt", 500);
  }
}
