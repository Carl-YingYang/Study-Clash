import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { buildRoomInfo, makeToken, uniqueRoomCode } from "@/lib/rooms";
import {
  isValidAiLevel,
  isValidCharacterId,
  AI_LEVEL_META,
  TIMER_OPTIONS,
} from "@/lib/characters";

/**
 * POST /api/game/practice — create a solo practice room against a server-side
 * AI opponent. The opponent participates in the real scoring pipeline.
 * Body: { quizId, timerSeconds, aiLevel, characterId }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const quizId = typeof body?.quizId === "string" ? body.quizId : "";
  const timerSeconds = Number(body?.timerSeconds);
  const aiLevel = typeof body?.aiLevel === "string" ? body.aiLevel.toUpperCase() : "";
  const characterId =
    typeof body?.characterId === "string" ? body.characterId : user.characterId;

  if (!isValidCharacterId(characterId)) {
    return NextResponse.json({ error: "Unknown character." }, { status: 400 });
  }
  if (!TIMER_OPTIONS.includes(timerSeconds as 10 | 15 | 20)) {
    return NextResponse.json({ error: "Timer must be 10, 15 or 20 seconds." }, { status: 400 });
  }
  if (!isValidAiLevel(aiLevel)) {
    return NextResponse.json({ error: "AI level must be EASY, MID, HARD or GENIUS." }, { status: 400 });
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

  const active = await db.gameParticipant.findFirst({
    where: { userId: user.id, room: { status: { in: ["lobby", "playing"] } } },
  });
  if (active) {
    return NextResponse.json(
      {
        error: "You already have a match in progress. Rejoin it from the dashboard, or leave it to start fresh.",
      },
      { status: 409 }
    );
  }

  const meta = AI_LEVEL_META[aiLevel];
  const code = await uniqueRoomCode();
  const room = await db.gameRoom.create({
    data: {
      code,
      mode: "PRACTICE",
      status: "lobby",
      hostId: user.id,
      quizId: quiz.id,
      questionCount: quiz.questionCount,
      difficulty: quiz.difficulty,
      timerSeconds,
      aiLevel,
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

  await db.gameParticipant.create({
    data: {
      roomId: room.id,
      userId: null,
      displayName: meta.label,
      characterId: meta.characterId,
      isHost: false,
      isAI: true,
      aiLevel,
      ready: true, // the bot is always ready
    },
  });

  const roomInfo = await buildRoomInfo(room.id);
  return NextResponse.json({ room: roomInfo, token: makeToken(user.id, room.id, participant.id) });
}
