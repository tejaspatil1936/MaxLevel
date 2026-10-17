import { NextRequest } from "next/server";
import { verifyToken } from "@/lib/proctorToken";
import { applyPhoneEvent } from "@/lib/phoneStrikes";
import { apiSuccess, apiError } from "@/lib/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, type, confidence, durationMs } = body;

    if (!token || !type) {
      return apiError("Missing required parameters (token, type)", 400);
    }

    const payload = verifyToken(token);
    if (!payload || payload.role !== "device") {
      return apiError("Unauthorized device token", 401);
    }

    const result = await applyPhoneEvent(payload.aid, String(type), {
      confidence: typeof confidence === "number" ? confidence : undefined,
      durationMs: typeof durationMs === "number" ? durationMs : undefined,
    });

    return apiSuccess(result);
  } catch (error: any) {
    return apiError(error?.message || "Failed to process proctor event", 500);
  }
}
