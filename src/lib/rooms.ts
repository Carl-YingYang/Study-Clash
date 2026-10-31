import { db } from "@/lib/db";
import { createGameToken } from "./game-token";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export async function uniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const existing = await db.gameRoom.findUnique({ where: { code } });
    if (!existing) return code;
  }
  // Practically unreachable; fall back to a longer code.
  return generateRoomCode() + generateRoomCode().slice(0, 2);
}

export interface RoomInfoDto {
  code: string;
  mode: "CLASH" | "PRACTICE";
  status: "lobby" | "playing" | "finished" | "abandoned";
  questionCount: number;
  difficulty: "EASY" | "NORMAL" | "HARD";
  timerSeconds: number;
  aiLevel: string | null;
  documentName: string;
  hostName: string;
}

export async function buildRoomInfo(roomId: string): Promise<RoomInfoDto | null> {
  const room = await db.gameRoom.findUnique({
    where: { id: roomId },
    include: {
      quiz: { include: { document: { select: { fileName: true } } } },
      host: { select: { username: true } },
    },
  });
  if (!room) return null;
  return {
    code: room.code,
    mode: room.mode as "CLASH" | "PRACTICE",
    status: room.status as RoomInfoDto["status"],
    questionCount: room.questionCount,
    difficulty: room.difficulty as RoomInfoDto["difficulty"],
    timerSeconds: room.timerSeconds,
    aiLevel: room.aiLevel,
    documentName: room.quiz.document.fileName,
    hostName: room.host.username,
  };
}

export function makeToken(uid: string, rid: string, pid: string): string {
  return createGameToken({ uid, rid, pid }, process.env.GAME_SECRET ?? "");
}
