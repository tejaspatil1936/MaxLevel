import { NextRequest } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { requireStudent } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireStudent(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }
    const user = authResult.user;

    const body = await req.json().catch(() => ({}));
    const testId = body.testId;
    if (!testId || typeof testId !== "string") {
      return apiError("testId is required", 400);
    }

    const sessionId = `sess_${testId}_${user.uid}`;
    const sessionRef = adminDb.collection("proctorSessions").doc(sessionId);
    const existingDoc = await sessionRef.get();
    const now = Date.now();

    let token = crypto.randomUUID();
    if (existingDoc.exists) {
      const existingData = existingDoc.data();
      // Reuse existing active session if created within 6 hours
      if (existingData?.token && existingData?.createdAt && now - existingData.createdAt < 6 * 60 * 60 * 1000) {
        return apiSuccess({
          sessionId,
          token: existingData.token,
          studentName: existingData.studentName || user.name || "Candidate",
          studentPrn: existingData.studentPrn || user.prn || "",
        });
      }
      if (existingData?.token) {
        token = existingData.token;
      }
    }

    // Only create fresh session if one didn't exist
    await sessionRef.set(
      {
        id: sessionId,
        testId,
        uid: user.uid,
        studentName: user.name || "Candidate",
        studentPrn: user.prn || "",
        token,
        status: "waiting",
        createdAt: now,
        lastPingPhone: 0,
        offer: null,
        answer: null,
        candidatesLaptop: [],
        candidatesPhone: [],
        phoneState: {
          inForeground: true,
          cameraOk: false,
          battery: null,
          moved: false,
          updatedAt: now,
        },
      },
      { merge: true }
    );

    return apiSuccess({
      sessionId,
      token,
      message: "Proctor session initialized",
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to initialize proctor session", 500);
  }
}
