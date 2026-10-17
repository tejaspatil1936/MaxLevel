import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/response";
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

    // Finalize expired attempts first
    await finalizeExpiredAttempts(testId);

    // Fetch attempts
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

    // Fetch user details
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

    // Sort by score desc, then timeTakenSec asc
    rawAttempts.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      return (a.timeTakenSec ?? 0) - (b.timeTakenSec ?? 0);
    });

    const csvData = rawAttempts.map((att) => {
      const profile = userProfiles[att.uid] || { name: "Student", prn: "—", email: "" };
      return {
        PRN: profile.prn,
        Name: profile.name,
        Email: profile.email,
        Score: att.score ?? 0,
        Total: att.total ?? 0,
        "Time Taken (s)": att.timeTakenSec ?? 0,
        Strikes: att.strikes ?? 0,
        Status: att.status,
        "Submit Reason":
          att.submitReasonDetail ||
          att.submitReason ||
          (att.status === "awaiting_start" ? "On rules screen (pairing)" : "—"),
        "Started At": att.startedAt || "",
        "Submitted At": att.submittedAt || "",
      };
    });

    const csvString = Papa.unparse(csvData);

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attempts_${testId}.csv"`,
      },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to export attempts", 500);
  }
}
