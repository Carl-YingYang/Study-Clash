import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import type { QuizDifficulty } from "@/lib/characters";

/**
 * GET /api/profile — performance statistics and recent match history.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const results = await db.playerResult.findMany({
    where: { userId: user.id },
    include: { session: true },
    orderBy: { session: { finishedAt: "desc" } },
  });

  const documents = await db.document.count({ where: { ownerId: user.id } });
  const quizzes = await db.quiz.count({ where: { document: { ownerId: user.id }, status: "ready" } });

  let clashGames = 0,
    clashWins = 0,
    practiceGames = 0,
    practiceWins = 0,
    correct = 0,
    total = 0,
    bestScore = 0;
  const charCount = new Map<string, number>();
  const diffAgg = new Map<string, { correct: number; total: number; games: number }>();
  const divisionAgg = new Map<number, { correct: number; total: number; games: number; best: number }>();

  for (const r of results) {
    if (r.session.mode === "CLASH") {
      clashGames++;
      if (r.won) clashWins++;
    } else {
      practiceGames++;
      if (r.won) practiceWins++;
    }
    correct += r.correctCount;
    total += r.totalQuestions;
    bestScore = Math.max(bestScore, r.score);
    charCount.set(r.characterId, (charCount.get(r.characterId) ?? 0) + 1);
    const d = diffAgg.get(r.session.difficulty) ?? { correct: 0, total: 0, games: 0 };
    d.correct += r.correctCount;
    d.total += r.totalQuestions;
    d.games += 1;
    diffAgg.set(r.session.difficulty, d);
    const div = divisionAgg.get(r.session.questionCount) ?? {
      correct: 0,
      total: 0,
      games: 0,
      best: 0,
    };
    div.correct += r.correctCount;
    div.total += r.totalQuestions;
    div.games += 1;
    div.best = Math.max(div.best, r.score);
    divisionAgg.set(r.session.questionCount, div);
  }

  let favoriteCharacter: string | null = null;
  let favCount = 0;
  for (const [cid, n] of charCount) {
    if (n > favCount) {
      favCount = n;
      favoriteCharacter = cid;
    }
  }

  let bestDifficulty: QuizDifficulty | null = null;
  let bestAcc = -1;
  for (const [diff, agg] of diffAgg) {
    if (agg.games >= 2 || bestDifficulty === null) {
      const acc = agg.total ? agg.correct / agg.total : 0;
      if (acc > bestAcc && agg.games >= 1) {
        bestAcc = acc;
        bestDifficulty = diff as QuizDifficulty;
      }
    }
  }

  // Recent games with opponent info.
  const sessionIds = results.slice(0, 10).map((r) => r.sessionId);
  const opponentResults = await db.playerResult.findMany({
    where: { sessionId: { in: sessionIds }, userId: { not: user.id } },
    select: { sessionId: true, displayName: true, isAI: true },
  });
  const opponentBySession = new Map<string, string>();
  for (const o of opponentResults) {
    opponentBySession.set(o.sessionId, o.displayName);
  }

  return NextResponse.json({
    profile: {
      username: dbUser.username,
      characterId: dbUser.characterId,
      memberSince: dbUser.createdAt.toISOString(),
      totalGames: results.length,
      clashGames,
      clashWins,
      practiceGames,
      practiceWins,
      overallAccuracy: total ? correct / total : 0,
      bestScore,
      favoriteCharacter,
      bestDifficulty,
      divisionStats: [10, 20, 30].map((division) => {
        const agg = divisionAgg.get(division);
        return {
          division,
          games: agg?.games ?? 0,
          accuracy: agg && agg.total ? agg.correct / agg.total : 0,
          bestScore: agg?.best ?? 0,
        };
      }),
      documents,
      quizzes,
      recentGames: results.slice(0, 10).map((r) => ({
        id: r.id,
        mode: r.session.mode as "CLASH" | "PRACTICE",
        questionCount: r.session.questionCount,
        difficulty: r.session.difficulty as QuizDifficulty,
        score: r.score,
        correctCount: r.correctCount,
        totalQuestions: r.totalQuestions,
        accuracy: r.accuracy,
        avgTimeMs: r.avgTimeMs,
        won: r.won,
        abilityUsed: r.abilityUsed,
        characterId: r.characterId,
        opponentName: opponentBySession.get(r.sessionId) ?? "—",
        finishedAt: r.session.finishedAt.toISOString(),
      })),
    },
  });
}
