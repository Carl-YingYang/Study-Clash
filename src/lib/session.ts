import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  characterId: string;
}

/** Returns the authenticated user or null. Server-side only. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const u = session.user as { id?: string; name?: string | null; characterId?: string };
  if (!u.id) return null;
  return {
    id: u.id,
    name: u.name ?? "player",
    characterId: u.characterId ?? "thinker",
  };
}
