import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { buildRoomInfo, makeToken } from "@/lib/rooms";

/**
 * POST /api/rooms/join — join a CLASH room by its 6-character code.
 * Body: { code: string }
 *
 * Rules:
 * - The room must exist, be a CLASH room and still be in the lobby.
 * - A third player cannot join a full room.
 * - A participant who rejoins (e.g. after a refresh) receives a fresh token.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid room code." }, { status: 400 });
  }

  const room = await db.gameRoom.findUnique({
    where: { code },
    include: { participants: true },
  });
  if (!room) {
    return NextResponse.json({ error: "No room found with that code." }, { status: 404 });
  }
  if (room.mode !== "CLASH") {
    return NextResponse.json({ error: "That room is a practice session." }, { status: 422 });
  }
  if (room.status === "playing" || room.status === "finished" || room.status === "abandoned") {
    return NextResponse.json(
      { error: "That match has already started or ended." },
      { status: 409 }
    );
  }

  const mine = room.participants.find((p) => p.userId === user.id);
  if (mine) {
    // Reconnect case.
    const roomInfo = await buildRoomInfo(room.id);
    return NextResponse.json({ room: roomInfo, token: makeToken(user.id, room.id, mine.id), reconnected: true });
  }

  if (room.participants.length >= 2) {
    return NextResponse.json({ error: "That room is already full (2 players max)." }, { status: 409 });
  }

  // Block joining while already in another active match.
  const active = await db.gameParticipant.findFirst({
    where: { userId: user.id, room: { status: { in: ["lobby", "playing"] } } },
  });
  if (active) {
    return NextResponse.json(
      {
        error: "You already have a match in progress. Rejoin it from the dashboard, or leave it to join this room.",
      },
      { status: 409 }
    );
  }

  const participant = await db.gameParticipant.create({
    data: {
      roomId: room.id,
      userId: user.id,
      displayName: user.name,
      characterId: user.characterId,
      isHost: false,
    },
  });

  const roomInfo = await buildRoomInfo(room.id);
  return NextResponse.json({ room: roomInfo, token: makeToken(user.id, room.id, participant.id) });
}
