// STUDY CLASH — game room tokens
// The Next.js API issues HMAC-signed tokens after authenticating a user with
// NextAuth. The socket.io game service verifies them at connection time, so
// the realtime layer never trusts client-supplied identity.

import { createHmac, timingSafeEqual } from "crypto";

export interface GameTokenPayload {
  uid: string; // user id
  rid: string; // room id
  pid: string; // participant id
  iat: number;
  exp: number; // expiry (epoch ms)
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createGameToken(
  payload: Omit<GameTokenPayload, "iat" | "exp">,
  secret: string,
  ttlMs = 6 * 60 * 60 * 1000
): string {
  const now = Date.now();
  const full: GameTokenPayload = { ...payload, iat: now, exp: now + ttlMs };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body, secret)}`;
}

export function verifyGameToken(token: unknown, secret: string): GameTokenPayload | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as GameTokenPayload;
    if (!payload.uid || !payload.rid || !payload.pid) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
