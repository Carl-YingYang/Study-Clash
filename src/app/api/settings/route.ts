import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isValidCharacterId } from "@/lib/characters";

/**
 * PATCH /api/settings — update the account's default character.
 */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const characterId = typeof body?.characterId === "string" ? body.characterId : "";
  if (!isValidCharacterId(characterId)) {
    return NextResponse.json({ error: "Unknown character." }, { status: 400 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { characterId },
  });

  return NextResponse.json({ ok: true, characterId });
}
