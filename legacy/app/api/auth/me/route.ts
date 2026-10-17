import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { apiSuccess } from "@/lib/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ("errorResponse" in authResult) {
    return authResult.errorResponse;
  }

  return apiSuccess({ user: authResult.user });
}
