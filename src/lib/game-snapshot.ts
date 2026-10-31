
import type { Prisma } from "@prisma/client";
import type {
  RoomStatePayload,
  QuestionPayload,
  RoundResultPayload,
  GameOverPayload,
} from "@/lib/types";

type GamePhase =
  | "lobby"
  | "countdown"
  | "question"
  | "reveal"
  | "finished"
  | "abandoned";

export interface GameSnapshot {
  roomState: RoomStatePayload;
  countdown: number | null;
  question: (QuestionPayload & {
    youAnswered?: number | null;
    eliminated?: number[] | null;
  }) | null;
  roundResult: RoundResultPayload | null;
  gameOver: GameOverPayload | null;
}

function parseChoices(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
  } catch {
    // Invalid stored question data is handled below.
  }

  throw new Error("Invalid choices stored for this question.");
}

function parseEliminated(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          Number.isInteger(item) &&
          item >= 0 &&
          item <= 3
      )
    ) {
      return parsed;
    }
  } catch {
    // Treat invalid optional ability state as empty.
  }

  return [];
}

export async function buildGameSnapshot(
  tx: Prisma.TransactionClient,
  roomId: string,
  userId: string
): Promise<GameSnapshot> {
  const room = await tx.gameRoom.findFirst({
    where: {
      id: roomId,
      participants: {
        some: { userId },
      },
    },
    include: {
      quiz: {
        include: {
          document: {
            select: { fileName: true },
          },
        },
      },
      host: {
        select: { username: true },
      },
      participants: true,
    },
  });

  if (!room) {
    throw new Error("Room not found or access denied.");
  }

  const mine = room.participants.find(
    (participant) => participant.userId === userId
  );

  if (!mine) {
    throw new Error("You are not a participant in this room.");
  }

  const allowedPhases: GamePhase[] = [
    "lobby",
    "countdown",
    "question",
    "reveal",
    "finished",
    "abandoned",
  ];

  if (!allowedPhases.includes(room.phase as GamePhase)) {
    throw new Error("Invalid room phase.");
  }

  const phase = room.phase as GamePhase;
  const qIndex = room.currentQuestionIndex;
  const now = Date.now();

  const answers = await tx.playerAnswer.findMany({
    where: {
      questionIndex: qIndex,
      participant: {
        roomId,
      },
    },
  });

  const answerByParticipant = new Map(
    answers.map((answer) => [answer.participantId, answer])
  );

  const roomState: RoomStatePayload = {
    room: {
      code: room.code,
      mode: room.mode as "CLASH" | "PRACTICE",
      status: room.status as RoomStatePayload["room"]["status"],
      questionCount: room.questionCount,
      difficulty: room.difficulty as RoomStatePayload["room"]["difficulty"],
      timerSeconds: room.timerSeconds,
      aiLevel: room.aiLevel as RoomStatePayload["room"]["aiLevel"],
      documentName: room.quiz.document.fileName,
      hostName: room.host.username,
    },
    phase,
    players: room.participants.map((participant) => ({
      pid: participant.id,
      name: participant.displayName,
      characterId: participant.characterId as RoomStatePayload["players"][number]["characterId"],
      isHost: participant.isHost,
      isAI: participant.isAI,
      aiLevel: participant.aiLevel as RoomStatePayload["players"][number]["aiLevel"],
      score: participant.score,
      ready: participant.ready,
      abilityUsed: participant.abilityUsed,
      abilityArmed: participant.abilityActive,
      connected: participant.userId === userId,
      submitted: answerByParticipant.has(participant.id),
    })),
    you: {
      pid: mine.id,
      isHost: mine.isHost,
    },
    qIndex,
  };

  const countdown =
    phase === "countdown" && room.phaseEndsAt
      ? Math.max(0, Math.ceil((room.phaseEndsAt.getTime() - now) / 1000))
      : null;

  let question: GameSnapshot["question"] = null;
  let roundResult: RoundResultPayload | null = null;
  let gameOver: GameOverPayload | null = null;

  if (
    phase === "question" ||
    phase === "reveal" ||
    phase === "finished"
  ) {
    const currentQuestion = await tx.question.findFirst({
      where: {
        quizId: room.quizId,
        order: qIndex,
      },
    });

    if (phase === "question" && !currentQuestion) {
      throw new Error("The active question could not be found.");
    }

    if (currentQuestion && phase === "question") {
      const myAnswer = answerByParticipant.get(mine.id);

      question = {
        index: qIndex,
        total: room.questionCount,
        text: currentQuestion.text,
        choices: parseChoices(currentQuestion.choices),
        difficulty: room.difficulty as QuestionPayload["difficulty"],
        timerMs: room.timerSeconds * 1000,
        endsAt: mine.answerDeadline?.getTime() ?? now,
        serverTime: now,
        youAnswered: myAnswer?.choiceIndex ?? null,
        eliminated: parseEliminated(mine.eliminatedChoices),
      };
    }

    if (currentQuestion && phase === "reveal") {
      roundResult = {
        index: qIndex,
        text: currentQuestion.text,
        choices: parseChoices(currentQuestion.choices),
        correctIndex: currentQuestion.correctIndex,
        explanation: currentQuestion.explanation,
        sourceRef: currentQuestion.sourceRef,
        results: room.participants.map((participant) => {
          const answer = answerByParticipant.get(participant.id);
          const choiceIndex = answer?.choiceIndex ?? null;
          const correct = choiceIndex !== null &&
            choiceIndex === currentQuestion.correctIndex;
          const points = answer?.points ?? 0;
          const base = correct ? 100 : 0;
          const abilityBonus = answer?.abilityBonus ?? 0;

          return {
            pid: participant.id,
            name: participant.displayName,
            choiceIndex,
            correct,
            points,
            base,
            speedBonus: Math.max(0, points - base - abilityBonus),
            abilityBonus,
            timeMs: answer?.timeMs ?? room.timerSeconds * 1000,
          };
        }),
        scores: room.participants.map((participant) => ({
          pid: participant.id,
          score: participant.score,
        })),
        nextAt: room.phaseEndsAt?.getTime() ?? now,
      };
    }
  }

  if (phase === "finished") {
    const session = await tx.gameSession.findFirst({
      where: { roomId },
      orderBy: { finishedAt: "desc" },
    });

    if (session) {
      const results = await tx.playerResult.findMany({
        where: { sessionId: session.id },
      });

      const questions = await tx.question.findMany({
        where: { quizId: room.quizId },
        orderBy: { order: "asc" },
      });

      const allAnswers = await tx.playerAnswer.findMany({
        where: {
          participant: { roomId },
        },
        orderBy: { questionIndex: "asc" },
      });

      gameOver = {
        mode: session.mode as "CLASH" | "PRACTICE",
        sessionId: session.id,
        results: results.map((result) => ({
          pid: result.participantId,
          name: result.displayName,
          characterId: result.characterId as GameOverPayload["results"][number]["characterId"],
          isAI: result.isAI,
          aiLevel: result.aiLevel as GameOverPayload["results"][number]["aiLevel"],
          score: result.score,
          correctCount: result.correctCount,
          totalQuestions: result.totalQuestions,
          accuracy: result.accuracy,
          avgTimeMs: result.avgTimeMs,
          abilityUsed: result.abilityUsed,
          won: result.won,
        })),
        review: questions.map((q) => ({
          index: q.order,
          text: q.text,
          choices: parseChoices(q.choices),
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          sourceRef: q.sourceRef,
          answers: room.participants.map((participant) => {
            const answer = allAnswers.find(
              (item) =>
                item.participantId === participant.id &&
                item.questionIndex === q.order
            );

            return {
              pid: participant.id,
              name: participant.displayName,
              choiceIndex: answer?.choiceIndex ?? null,
              correct: answer?.correct ?? false,
              points: answer?.points ?? 0,
            };
          }),
        })),
      };
    }
  }

  return {
    roomState,
    countdown,
    question,
    roundResult,
    gameOver,
  };
}
