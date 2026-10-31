import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { QUESTION_COUNTS, QUIZ_DIFFICULTIES, isValidCharacterId } from "@/lib/characters";

/**
 * GET /api/leaderboard?division=10|20|30&difficulty=EASY|NORMAL|HARD|ALL&mode=clash|practice
 *
 * Rankings are always computed from COMPLETED matches only (GameSession rows
 * are created exclusively when a match finishes; abandoned games never enter).
 * Practice records are kept strictly separate from Clash rankings.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  const url = new URL(req.url);
  const division = Number(url.searchParams.get("division") ?? "10");
  const difficulty = (url.searchParams.get("difficulty") ?? "ALL").toUpperCase();
  const mode = (url.searchParams.get("mode") ?? "clash").toLowerCase();

  if (!QUESTION_COUNTS.includes(division as 10 | 20 | 30)) {
    return NextResponse.json({ error: "Division must be 10, 20 or 30." }, { status: 400 });
  }
  if (difficulty !== "ALL" && !QUIZ_DIFFICULTIES.includes(difficulty as "EASY")) {
    return NextResponse.json({ error: "Invalid difficulty filter." }, { status: 400 });
  }
  if (mode !== "clash" && mode !== "practice") {
    return NextResponse.json({ error: "Mode must be clash or practice." }, { status: 400 });
  }

  const results = await db.playerResult.findMany({
    where: {
      isAI: false,
      session: {
        mode: mode === "clash" ? "CLASH" : "PRACTICE",
        questionCount: division,
        ...(difficulty !== "ALL" ? { difficulty } : {}),
      },
    },
    select: {
      userId: true,
      characterId: true,
      score: true,
      correctCount: true,
      totalQuestions: true,
      won: true,
    },
  });

  interface Agg {
    userId: string;
    characterId: string;
    totalPoints: number;
    correct: number;
    total: number;
    games: number;
    wins: number;
    bestScore: number;
  }
  const byUser = new Map<string, Agg>();
  for (const r of results) {
    if (!r.userId) continue;
    let agg = byUser.get(r.userId);
    if (!agg) {
      agg = {
        userId: r.userId,
        characterId: r.characterId,
        totalPoints: 0,
        correct: 0,
        total: 0,
        games: 0,
        wins: 0,
        bestScore: 0,
      };
      byUser.set(r.userId, agg);
    }
    agg.totalPoints += r.score;
    agg.correct += r.correctCount;
    agg.total += r.totalQuestions;
    agg.games += 1;
    agg.wins += r.won ? 1 : 0;
    agg.bestScore = Math.max(agg.bestScore, r.score);
    agg.characterId = r.characterId; // most recent appearance wins
  }

  const aggs = [...byUser.values()];
  // Fair ranking: total points first, accuracy as tie-breaker, fewer games
  // played as final tie-breaker (same points with fewer games = higher avg).
  aggs.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const accA = a.total ? a.correct / a.total : 0;
    const accB = b.total ? b.correct / b.total : 0;
    if (accB !== accA) return accB - accA;
    return a.games - b.games;
  });

  const userIds = aggs.map((a) => a.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  const entries = aggs.slice(0, 50).map((a, i) => ({
    rank: i + 1,
    userId: a.userId,
    username: nameById.get(a.userId) ?? "unknown",
    characterId: isValidCharacterId(a.characterId) ? a.characterId : "thinker",
    totalPoints: a.totalPoints,
    accuracy: a.total ? a.correct / a.total : 0,
    games: a.games,
    wins: a.wins,
    bestScore: a.bestScore,
  }));

  let me: (typeof entries)[number] | null = null;
  if (user) {
    const idx = aggs.findIndex((a) => a.userId === user.id);
    if (idx >= 0) {
      const a = aggs[idx];
      me = {
        rank: idx + 1,
        userId: a.userId,
        username: nameById.get(a.userId) ?? "unknown",
        characterId: isValidCharacterId(a.characterId) ? a.characterId : "thinker",
        totalPoints: a.totalPoints,
        accuracy: a.total ? a.correct / a.total : 0,
        games: a.games,
        wins: a.wins,
        bestScore: a.bestScore,
      };
    }
  }

  return NextResponse.json({ entries, me });
}
