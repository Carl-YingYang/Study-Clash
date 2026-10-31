import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { buildRoomInfo, makeToken, uniqueRoomCode } from "@/lib/rooms";
import { isValidCharacterId, TIMER_OPTIONS } from "@/lib/characters";

/**
 * GET /api/rooms — returns the caller's active room (lobby or in-progress),
 * issuing a fresh game token so a refreshed client can reconnect.
 * Phantom rooms (lobbies older than 2h / matches older than 4h with no live
 * runtime) are retired automatically so nobody stays blocked.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const participant = await db.gameParticipant.findFirst({
    where: {
      userId: user.id,
      room: { status: { in: ["lobby", "playing"] } },
    },
    orderBy: { joinedAt: "desc" },
    include: { room: true },
  });
  if (!participant) return NextResponse.json({ room: null });

  const ageMs = Date.now() - participant.room.createdAt.getTime();
  const stale =
    (participant.room.status === "lobby" && ageMs > 2 * 60 * 60 * 1000) ||
    (participant.room.status === "playing" && ageMs > 4 * 60 * 60 * 1000);
  if (stale) {
    await db.gameRoom
      .update({ where: { id: participant.roomId }, data: { status: "abandoned", endedAt: new Date() } })
      .catch(() => undefined);
    return NextResponse.json({ room: null });
  }

  const roomInfo = await buildRoomInfo(participant.roomId);
  if (!roomInfo) return NextResponse.json({ room: null });

  return NextResponse.json({
    room: roomInfo,
    token: makeToken(user.id, participant.roomId, participant.id),
    isHost: participant.isHost,
  });
}

/**
 * POST /api/rooms — create a CLASH room from one of the caller's quizzes.
 * Body: { quizId, timerSeconds, characterId }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const quizId = typeof body?.quizId === "string" ? body.quizId : "";
  const timerSeconds = Number(body?.timerSeconds);
  const characterId = typeof body?.characterId === "string" ? body.characterId : user.characterId;

  if (!isValidCharacterId(characterId)) {
    return NextResponse.json({ error: "Unknown character." }, { status: 400 });
  }
  if (!TIMER_OPTIONS.includes(timerSeconds as 10 | 15 | 20)) {
    return NextResponse.json({ error: "Timer must be 10, 15 or 20 seconds." }, { status: 400 });
  }

  const quiz = await db.quiz.findFirst({
    where: { id: quizId, document: { ownerId: user.id } },
  });
  if (!quiz) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  if (quiz.status !== "ready") {
    return NextResponse.json(
      { error: quiz.error ?? "This quiz is not ready to play." },
      { status: 422 }
    );
  }

  // One active room per player at a time.
  const active = await db.gameParticipant.findFirst({
    where: { userId: user.id, room: { status: { in: ["lobby", "playing"] } } },
    include: { room: { select: { code: true } } },
  });
  if (active) {
    return NextResponse.json(
      {
        error: `You already have a match in progress (room ${active.room.code}). Rejoin it from the dashboard, or leave it to start fresh.`,
      },
      { status: 409 }
    );
  }

  const code = await uniqueRoomCode();
  const room = await db.gameRoom.create({
    data: {
      code,
      mode: "CLASH",
      status: "lobby",
      hostId: user.id,
      quizId: quiz.id,
      questionCount: quiz.questionCount,
      difficulty: quiz.difficulty,
      timerSeconds,
    },
  });

  const participant = await db.gameParticipant.create({
    data: {
      roomId: room.id,
      userId: user.id,
      displayName: user.name,
      characterId,
      isHost: true,
    },
  });

  const roomInfo = await buildRoomInfo(room.id);
  return NextResponse.json({ room: roomInfo, token: makeToken(user.id, room.id, participant.id) });
}
