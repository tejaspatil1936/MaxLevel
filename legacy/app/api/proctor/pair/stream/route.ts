import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { proctorSignalBus, SignalPayload } from "@/lib/proctor-signal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const token = searchParams.get("token");
  const role = searchParams.get("role") || "unknown";

  if (!sessionId || !token) {
    return new Response("Missing sessionId or token", { status: 400 });
  }

  // Verify session & token from Firestore
  try {
    const sessionDoc = await adminDb.collection("proctorSessions").doc(sessionId).get();
    if (!sessionDoc.exists) {
      return new Response("Session not found", { status: 404 });
    }
    const session = sessionDoc.data();
    if (session?.token !== token) {
      return new Response("Unauthorized", { status: 403 });
    }
  } catch (err: any) {
    return new Response(err?.message || "Internal Error", { status: 500 });
  }

  let cleanup: (() => void) | null = null;
  let keepAliveTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const pushEvent = (eventData: any) => {
        try {
          const payload = `data: ${JSON.stringify(eventData)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream might be closed
        }
      };

      // 1. Send initial state immediately upon connecting
      try {
        const doc = await adminDb.collection("proctorSessions").doc(sessionId).get();
        if (doc.exists) {
          const data = doc.data();
          pushEvent({
            type: "init",
            data: {
              status: data?.status,
              phoneState: data?.phoneState,
              offer: data?.offer,
              answer: data?.answer,
              candidatesLaptop: data?.candidatesLaptop || [],
              candidatesPhone: data?.candidatesPhone || [],
            },
            from: "system",
            timestamp: Date.now(),
          });
        }
      } catch {}

      // 2. Subscribe to real-time in-memory signal bus (sub-millisecond latency!)
      cleanup = proctorSignalBus.subscribe(sessionId, (payload: SignalPayload) => {
        pushEvent(payload);
      });

      // 3. Heartbeat ping to keep SSE connection open
      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAliveTimer!);
        }
      }, 15000);
    },
    cancel() {
      if (cleanup) cleanup();
      if (keepAliveTimer) clearInterval(keepAliveTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx / proxy buffering
    },
  });
}
