import { createHmac, timingSafeEqual } from "crypto";

export interface GameTokenPayload {
  uid: string;
  rid: string;
  pid: string;
  iat: number;
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Verify a game token issued by the Next.js API. */
export function verifyGameToken(token: unknown, secret: string): GameTokenPayload | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GameTokenPayload;
    if (!payload.uid || !payload.rid || !payload.pid) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
