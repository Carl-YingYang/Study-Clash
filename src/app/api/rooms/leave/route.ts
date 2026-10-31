import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

/**
 * POST /api/rooms/leave — escape hatch for stuck matches.
 *
 * Removes the caller from ANY room they are still attached to (lobby or
 * playing). Semantics:
 *  - Guest leaving a lobby  → participant row deleted; room stays open.
 *  - Host leaving           → the room is abandoned for everyone.
 *  - Player in a live match → the room is abandoned for everyone.
 *
 * This exists so a stale "match in progress" can never permanently block a
 * player from starting or joining new games.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await db.gameParticipant.findFirst({
    where: {
      userId: user.id,
      room: { status: { in: ["lobby", "playing"] } },
    },
    orderBy: { joinedAt: "desc" },
    include: { room: { select: { id: true, code: true, status: true } } },
  });

  if (!participant) {
    return NextResponse.json({ left: false, message: "You are not in any active match." });
  }

  const room = participant.room;

  if (participant.isHost || room.status === "playing") {
    // Host leaving, or anyone leaving a running match → abandon the room.
    // (Participant rows stay as history; the status change unblocks everyone.)
    await db.gameRoom.update({
      where: { id: room.id },
      data: { status: "abandoned", endedAt: new Date() },
    });
    // Notify the game engine so any connected sockets are told immediately.
    notifyEngineAbandon(room.id, `The match was closed (${user.name} left).`);
    return NextResponse.json({
      left: true,
      message: `Left room ${room.code}. The match was closed.`,
      abandoned: true,
    });
  }

  // Guest leaving a lobby → just remove them.
  await db.gameParticipant.delete({ where: { id: participant.id } });
  return NextResponse.json({
    left: true,
    message: `Left room ${room.code}.`,
    abandoned: false,
  });
}

/** Fire-and-forget: tell the game service to abandon a room by id. */
function notifyEngineAbandon(roomId: string, reason: string) {
  const secret = process.env.GAME_SECRET ?? "";
  if (!secret) return;
  void fetch("http://localhost:3002/internal/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-game-secret": secret },
    body: JSON.stringify({ roomId, reason }),
  }).catch(() => undefined);
}
