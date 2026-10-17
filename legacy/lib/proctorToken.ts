import { createHmac, timingSafeEqual } from "crypto";

const secret = process.env.PROCTOR_SECRET || "mitaoe-prep-proctor-secret-dev-key-change-in-prod";
export type TokenPayload = { aid: string; uid: string; role: "pair" | "device"; exp: number };

export function signToken(p: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", secret).update(body).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}
