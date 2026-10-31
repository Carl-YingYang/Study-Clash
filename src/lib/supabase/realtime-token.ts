import "server-only";

import { importJWK, SignJWT, type JWK } from "jose";

type SigningJWK = JWK & {
  kid?: string;
  kty?: string;
  crv?: string;
  d?: string;
};

export async function createSupabaseRealtimeToken(userId: string) {
  if (!userId) {
    throw new Error("A valid application user ID is required.");
  }

  const rawJwk = process.env.SUPABASE_JWT_PRIVATE_JWK;

  if (!rawJwk) {
    throw new Error("Missing Supabase JWT private key.");
  }

  let jwk: SigningJWK;

  try {
    jwk = JSON.parse(rawJwk) as SigningJWK;
  } catch {
    throw new Error("Invalid Supabase JWT private key JSON.");
  }

  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    !jwk.kid ||
    !jwk.d ||
    !jwk.x ||
    !jwk.y
  ) {
    throw new Error("Invalid ES256 private signing key.");
  }

  const privateKey = await importJWK(jwk, "ES256");

  return new SignJWT({
    role: "authenticated",
    app_user_id: userId,
  })
    .setProtectedHeader({
      alg: "ES256",
      kid: jwk.kid,
      typ: "JWT",
    })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}