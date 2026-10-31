
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildGameSnapshot, type GameSnapshot } from "@/lib/game-snapshot";
import { broadcastRoomEvent } from "@/lib/supabase/broadcast";
import { decideAiAnswer, pickAiChoice } from "@/lib/game-ai";
import { computeQuestionScore, REVEAL_SECONDS, COUNTDOWN_SECONDS, SPRINTER_EXTRA_MS } from "@/lib/scoring";
import { isValidCharacterId, type AbilityId } from "@/lib/characters";

type Tx = Prisma.TransactionClient;

export type GameAction =
  | "sync"
  | "tick"
  | "ready"
  | "character"
  | "start"
  | "answer"
  | "ability"
  | "next"
  | "rematch"
  | "leave";

export class GameActionError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "GameActionError";
  }
}

const CHARACTER_ABILITY: Record<string, AbilityId> = {
  thinker: "second_chance",
  scholar: "focus_mode",
  sprinter: "quick_reflex",
  trickster: "double_down",
  wildcard: "lucky_break",
};

async function getRoom(tx: Tx, roomId: string) {
  const room = await tx.gameRoom.findUnique({
    where: { id: roomId },
    include: {
      participants: true,
      quiz: true,
    },
  });

  if (!room) {
    throw new GameActionError("Room not found.", 404);
  }

  return room;
}

async function getPlayer(tx: Tx, roomId: string, userId: string) {
  const player = await tx.gameParticipant.findFirst({
    where: {
      roomId,
      userId,
    },
  });

  if (!player) {
    throw new GameActionError("You are not a participant of this room.", 403);
  }

  return player;
}

function parseChoices(value: string): string[] {
  let choices: unknown;

  try {
    choices = JSON.parse(value);
  } catch {
    throw new GameActionError("The quiz contains invalid choices.", 500);
  }

  if (
    !Array.isArray(choices) ||
    choices.length !== 4 ||
    !choices.every((choice) => typeof choice === "string")
  ) {
    throw new GameActionError("The quiz contains invalid choices.", 500);
  }

  return choices;
}

function parseEliminated(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      Array.isArray(parsed) &&
      parsed.every((v) => Number.isInteger(v) && v >= 0 && v <= 3)
    ) {
      return parsed;
    }
  } catch {
    // Invalid optional ability state is treated as empty.
  }

  return [];
}

async function startQuestion(tx: Tx, roomId: string, index: number) {
  const room = await getRoom(tx, roomId);

  const question = await tx.question.findFirst({
    where: {
      quizId: room.quizId,
      order: index,
    },
  });

  if (!question) {
    await tx.gameRoom.update({
      where: { id: roomId },
      data: {
        status: "abandoned",
        phase: "abandoned",
        endedAt: new Date(),
        phaseEndsAt: null,
      },
    });

    return;
  }

  parseChoices(question.choices);

  const now = new Date();
  const timerMs = room.timerSeconds * 1000;
  const deadline = new Date(now.getTime() + timerMs);

  await tx.gameRoom.update({
    where: { id: roomId },
    data: {
      status: "playing",
      phase: "question",
      currentQuestionIndex: index,
      phaseStartedAt: now,
      phaseEndsAt: deadline,
      stateVersion: { increment: 1 },
    },
  });

  for (const participant of room.participants) {
    let pendingAiAt: Date | null = null;
    let pendingAiChoice: number | null = null;
    let answerDeadline = deadline;

    if (participant.isAI) {
      const decision = decideAiAnswer(
        participant.aiLevel ?? "MID",
        room.difficulty,
        timerMs
      );

      const delay = Math.min(decision.delayMs, timerMs + 600);

      pendingAiAt = new Date(now.getTime() + delay);

      // Bots that would answer after their normal deadline time out.
      if (delay <= timerMs) {
        pendingAiChoice = pickAiChoice(
          decision.correct,
          question.correctIndex
        );
      }
    }

    await tx.gameParticipant.update({
      where: { id: participant.id },
      data: {
        answerDeadline,
        eliminatedChoices: "[]",
        readyForNext: false,
        pendingAiChoice,
        pendingAiAt,
      },
    });
  }
}

async function lockRound(tx: Tx, roomId: string, now: Date) {
  const room = await getRoom(tx, roomId);

  if (room.phase !== "question") return;

  const question = await tx.question.findFirst({
    where: {
      quizId: room.quizId,
      order: room.currentQuestionIndex,
    },
  });

  if (!question) {
    throw new GameActionError("The active question could not be found.", 500);
  }

  const timerMs = room.timerSeconds * 1000;

  const answers = await tx.playerAnswer.findMany({
    where: {
      questionIndex: room.currentQuestionIndex,
      participant: { roomId },
    },
  });

  const answerMap = new Map(
    answers.map((answer) => [answer.participantId, answer])
  );

  const results = [];

  for (const participant of room.participants) {
    const answer = answerMap.get(participant.id);
    const choiceIndex = answer?.choiceIndex ?? null;
    const correct =
      choiceIndex !== null && choiceIndex === question.correctIndex;
    const timeMs = answer?.timeMs ?? timerMs;

    const score = computeQuestionScore({
      correct,
      timeMs,
      timerMs,
      armedAbility: participant.abilityActive as AbilityId | null,
    });

    const finalTimeMs = Math.max(0, Math.min(timeMs, timerMs));

    await tx.playerAnswer.upsert({
      where: {
        participantId_questionIndex: {
          participantId: participant.id,
          questionIndex: room.currentQuestionIndex,
        },
      },
      create: {
        participantId: participant.id,
        questionIndex: room.currentQuestionIndex,
        choiceIndex,
        timeMs: finalTimeMs,
        correct,
        points: score.total,
        abilityBonus: score.abilityBonus,
      },
      update: {
        choiceIndex,
        timeMs: finalTimeMs,
        correct,
        points: score.total,
        abilityBonus: score.abilityBonus,
      },
    });

    await tx.gameParticipant.update({
      where: { id: participant.id },
      data: {
        score: participant.score + score.total,
        correctCount: participant.correctCount + (correct ? 1 : 0),
        abilityActive: null,
        pendingAiAt: null,
        pendingAiChoice: null,
        readyForNext: false,
      },
    });

    const results: Array<{
    pid: string;
    name: string;
    choiceIndex: number | null;
    correct: boolean;
    points: number;
    base: number;
    speedBonus: number;
    abilityBonus: number;
    timeMs: number;
    }> = [];
  }

  await tx.gameRoom.update({
    where: { id: roomId },
    data: {
      phase: "reveal",
      phaseStartedAt: now,
      phaseEndsAt: new Date(now.getTime() + REVEAL_SECONDS * 1000),
      stateVersion: { increment: 1 },
    },
  });
}

async function finishGame(tx: Tx, roomId: string, now: Date) {
  const room = await getRoom(tx, roomId);

  if (room.phase === "finished") return;

  const answers = await tx.playerAnswer.findMany({
    where: { participant: { roomId } },
  });

  const maxScore = Math.max(
    ...room.participants.map((participant) => participant.score),
    0
  );

  const topCount = room.participants.filter(
    (participant) => participant.score === maxScore && maxScore > 0
  ).length;

  const session = await tx.gameSession.create({
    data: {
      roomId,
      mode: room.mode,
      questionCount: room.questionCount,
      difficulty: room.difficulty,
      timerSeconds: room.timerSeconds,
    },
  });

  for (const participant of room.participants) {
    const ownAnswers = answers.filter(
      (answer) => answer.participantId === participant.id
    );

    const avgTimeMs = ownAnswers.length
      ? Math.round(
          ownAnswers.reduce((total, answer) => total + answer.timeMs, 0) /
            ownAnswers.length
        )
      : room.timerSeconds * 1000;

    const won =
      maxScore > 0 &&
      participant.score === maxScore &&
      topCount === 1;

    await tx.playerResult.create({
      data: {
        sessionId: session.id,
        participantId: participant.id,
        userId: participant.userId,
        displayName: participant.displayName,
        characterId: participant.characterId,
        isAI: participant.isAI,
        aiLevel: participant.aiLevel,
        score: participant.score,
        correctCount: participant.correctCount,
        totalQuestions: room.questionCount,
        accuracy: room.questionCount
          ? participant.correctCount / room.questionCount
          : 0,
        avgTimeMs,
        abilityUsed: participant.abilityUsed,
        won,
      },
    });

    await tx.gameParticipant.update({
      where: { id: participant.id },
      data: {
        ready: false,
        readyForNext: false,
      },
    });
  }

  await tx.gameRoom.update({
    where: { id: roomId },
    data: {
      status: "finished",
      phase: "finished",
      endedAt: now,
      phaseStartedAt: now,
      phaseEndsAt: null,
      stateVersion: { increment: 1 },
    },
  });
}

async function advanceAfterReveal(tx: Tx, roomId: string, now: Date) {
  const room = await getRoom(tx, roomId);
  const nextIndex = room.currentQuestionIndex + 1;

  if (nextIndex < room.questionCount) {
    await startQuestion(tx, roomId, nextIndex);
  } else {
    await finishGame(tx, roomId, now);
  }
}

/**
 * Durable timer processing. This is invoked by client polling and
 * reconnects; it does not rely on a long-lived Vercel process.
 */
async function tickRoom(tx: Tx, roomId: string, now: Date) {
  let room = await getRoom(tx, roomId);

  if (room.phase === "countdown") {
    if (room.phaseEndsAt && room.phaseEndsAt <= now) {
      await startQuestion(tx, roomId, 0);
    }
    return;
  }

  if (room.phase === "question") {
    const existingAnswers = await tx.playerAnswer.findMany({
      where: {
        questionIndex: room.currentQuestionIndex,
        participant: { roomId },
      },
    });

    const answeredIds = new Set(
      existingAnswers.map((answer) => answer.participantId)
    );

    for (const participant of room.participants) {
      if (answeredIds.has(participant.id)) continue;

      const deadline =
        participant.answerDeadline ??
        new Date(
          (room.phaseStartedAt?.getTime() ?? now.getTime()) +
            room.timerSeconds * 1000
        );

      let choiceIndex: number | null | undefined;
      let answerTime: number | undefined;

      if (
        participant.isAI &&
        participant.pendingAiAt &&
        participant.pendingAiAt <= now &&
        participant.pendingAiAt <= deadline
      ) {
        choiceIndex = participant.pendingAiChoice;
        answerTime = Math.max(
          0,
          participant.pendingAiAt.getTime() -
            (room.phaseStartedAt?.getTime() ?? now.getTime())
        );
      } else if (deadline <= now) {
        choiceIndex = null;
        answerTime = room.timerSeconds * 1000;
      }

      if (answerTime !== undefined) {
        await tx.playerAnswer.create({
          data: {
            participantId: participant.id,
            questionIndex: room.currentQuestionIndex,
            choiceIndex: choiceIndex ?? null,
            timeMs: answerTime,
            correct: false,
            points: 0,
            abilityBonus: 0,
          },
        });
      }
    }

    const latestAnswers = await tx.playerAnswer.findMany({
      where: {
        questionIndex: room.currentQuestionIndex,
        participant: { roomId },
      },
      select: { participantId: true },
    });

    if (room.participants.every((participant) =>
      latestAnswers.some((answer) => answer.participantId === participant.id)
    )) {
      await lockRound(tx, roomId, now);
    }

    return;
  }

  if (room.phase === "reveal") {
    const humans = room.participants.filter(
      (participant) => !participant.isAI
    );

    const everyoneReady =
      humans.length > 0 &&
      humans.every((participant) => participant.readyForNext);

    const revealExpired =
      !room.phaseEndsAt || room.phaseEndsAt <= now;

    if (everyoneReady || revealExpired) {
      await advanceAfterReveal(tx, roomId, now);
    }

    return;
  }

  // Lobby, finished and abandoned rooms need no timer processing.
  room = await getRoom(tx, roomId);
}

export async function runGameAction(
  roomId: string,
  userId: string,
  action: GameAction,
  data: Record<string, unknown> = {}
): Promise<GameSnapshot | null> {
  if (!roomId || !userId) {
    throw new GameActionError("Room and user are required.", 400);
  }

  const now = new Date();

  const snapshot = await db.$transaction(
    async (tx) => {
      // Serialize all game operations for this room.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM public."GameRoom"
        WHERE "id" = ${roomId}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new GameActionError("Room not found.", 404);
      }

      await getPlayer(tx, roomId, userId);

      // Process expired countdowns, deadlines, AI responses and reveals
      // before accepting a new command.
      await tickRoom(tx, roomId, now);

      let room = await getRoom(tx, roomId);
      let player = await getPlayer(tx, roomId, userId);

      switch (action) {
        case "sync":
        case "tick":
          break;

        case "ready": {
          if (room.phase !== "lobby") {
            throw new GameActionError("The match is not in the lobby.");
          }

          await tx.gameParticipant.update({
            where: { id: player.id },
            data: { ready: data.value === true },
          });
          break;
        }

        case "character": {
          const characterId =
            typeof data.characterId === "string" ? data.characterId : "";

          if (!isValidCharacterId(characterId)) {
            throw new GameActionError("Unknown character.");
          }

          if (room.phase !== "lobby" && room.phase !== "finished") {
            throw new GameActionError(
              "Characters are locked once the match starts."
            );
          }

          await tx.gameParticipant.update({
            where: { id: player.id },
            data: {
              characterId,
              abilityUsed: false,
              abilityActive: null,
            },
          });
          break;
        }

        case "start": {
          if (!player.isHost) {
            throw new GameActionError("Only the host can start the match.", 403);
          }

          if (room.phase !== "lobby") {
            throw new GameActionError("The match has already started.");
          }

          const humans = room.participants.filter((p) => !p.isAI);

          if (humans.some((p) => !p.ready)) {
            throw new GameActionError("All players must be ready first.");
          }

          if (room.mode === "CLASH" && humans.length < 2) {
            throw new GameActionError(
              "Waiting for an opponent to join the room."
            );
          }

          const questionCount = await tx.question.count({
            where: { quizId: room.quizId },
          });

          if (questionCount < room.questionCount) {
            throw new GameActionError(
              "Quiz questions could not be loaded.",
              422
            );
          }

          await tx.playerAnswer.deleteMany({
            where: { participant: { roomId } },
          });

          await tx.gameParticipant.updateMany({
            where: { roomId },
            data: {
              score: 0,
              correctCount: 0,
              ready: false,
              abilityUsed: false,
              abilityActive: null,
              answerDeadline: null,
              eliminatedChoices: "[]",
              readyForNext: false,
              pendingAiChoice: null,
              pendingAiAt: null,
            },
          });

          await tx.gameParticipant.updateMany({
            where: { roomId, isAI: true },
            data: { ready: true },
          });

          const countdownEnd = new Date(
            now.getTime() + COUNTDOWN_SECONDS * 1000
          );

          await tx.gameRoom.update({
            where: { id: roomId },
            data: {
              status: "playing",
              phase: "countdown",
              currentQuestionIndex: 0,
              phaseStartedAt: now,
              phaseEndsAt: countdownEnd,
              endedAt: null,
              stateVersion: { increment: 1 },
            },
          });
          break;
        }

        case "answer": {
          if (room.phase !== "question") {
            throw new GameActionError("Question is no longer active.");
          }

          const index = Number(data.index);
          const choiceIndex = Number(data.choiceIndex);

          if (index !== room.currentQuestionIndex) {
            throw new GameActionError("Question is no longer active.");
          }

          if (
            !Number.isInteger(choiceIndex) ||
            choiceIndex < 0 ||
            choiceIndex > 3
          ) {
            throw new GameActionError("Invalid choice.");
          }

          if (player.isAI) {
            throw new GameActionError("AI answers cannot be submitted by clients.", 403);
          }

          if (
            !player.answerDeadline ||
            player.answerDeadline <= now
          ) {
            throw new GameActionError("Answer time is up.");
          }

          const eliminated = parseEliminated(player.eliminatedChoices);

          if (eliminated.includes(choiceIndex)) {
            throw new GameActionError("That choice has been eliminated.");
          }

          const existing = await tx.playerAnswer.findUnique({
            where: {
              participantId_questionIndex: {
                participantId: player.id,
                questionIndex: index,
              },
            },
          });

          if (existing) {
            throw new GameActionError("Your answer is already locked.");
          }

          const timeMs = Math.max(
            0,
            now.getTime() -
              (room.phaseStartedAt?.getTime() ?? now.getTime())
          );

          await tx.playerAnswer.create({
            data: {
              participantId: player.id,
              questionIndex: index,
              choiceIndex,
              timeMs,
              correct: false,
              points: 0,
              abilityBonus: 0,
            },
          });

          await tx.gameParticipant.update({
            where: { id: player.id },
            data: { readyForNext: false },
          });
          break;
        }

        case "ability": {
          if (room.phase !== "question") {
            throw new GameActionError(
              "Abilities can only be used during a question."
            );
          }

          if (player.isAI) {
            throw new GameActionError("AI players cannot use abilities.", 403);
          }

          if (player.abilityUsed) {
            throw new GameActionError(
              "Your character ability was already used this match."
            );
          }

          if (!player.answerDeadline || player.answerDeadline <= now) {
            throw new GameActionError("The question timer has expired.");
          }

          const existingAnswer = await tx.playerAnswer.findUnique({
            where: {
              participantId_questionIndex: {
                participantId: player.id,
                questionIndex: room.currentQuestionIndex,
              },
            },
          });

          if (existingAnswer) {
            throw new GameActionError(
              "Abilities must be used before answering."
            );
          }

          const ability = CHARACTER_ABILITY[player.characterId];

          if (!ability) {
            throw new GameActionError("Unknown character ability.");
          }

          if (ability === "second_chance") {
            const question = await tx.question.findFirst({
              where: {
                quizId: room.quizId,
                order: room.currentQuestionIndex,
              },
            });

            if (!question) {
              throw new GameActionError("Question not found.", 404);
            }

            const wrongChoices = [0, 1, 2, 3].filter(
              (i) => i !== question.correctIndex
            );

            for (let i = wrongChoices.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [wrongChoices[i], wrongChoices[j]] = [
                wrongChoices[j],
                wrongChoices[i],
              ];
            }

            await tx.gameParticipant.update({
              where: { id: player.id },
              data: {
                abilityUsed: true,
                abilityActive: null,
                eliminatedChoices: JSON.stringify(wrongChoices.slice(0, 2)),
              },
            });
          } else if (ability === "quick_reflex") {
            const extendedDeadline = new Date(
              player.answerDeadline.getTime() + SPRINTER_EXTRA_MS
            );

            await tx.gameParticipant.update({
              where: { id: player.id },
              data: {
                abilityUsed: true,
                answerDeadline: extendedDeadline,
              },
            });

            if (
              !room.phaseEndsAt ||
              extendedDeadline > room.phaseEndsAt
            ) {
              await tx.gameRoom.update({
                where: { id: roomId },
                data: { phaseEndsAt: extendedDeadline },
              });
            }
          } else {
            await tx.gameParticipant.update({
              where: { id: player.id },
              data: {
                abilityUsed: true,
                abilityActive: ability,
              },
            });
          }
          break;
        }

        case "next": {
          if (room.phase !== "reveal") {
            throw new GameActionError("The round is not in the reveal phase.");
          }

          await tx.gameParticipant.update({
            where: { id: player.id },
            data: { readyForNext: true },
          });
          break;
        }

        case "rematch": {
          if (!player.isHost) {
            throw new GameActionError(
              "Only the host can start a rematch.",
              403
            );
          }

          if (room.phase !== "finished") {
            throw new GameActionError(
              "Rematch is only available after a match ends."
            );
          }

          await tx.playerAnswer.deleteMany({
            where: { participant: { roomId } },
          });

          await tx.gameParticipant.updateMany({
            where: { roomId },
            data: {
              score: 0,
              correctCount: 0,
              ready: false,
              abilityUsed: false,
              abilityActive: null,
              answerDeadline: null,
              eliminatedChoices: "[]",
              readyForNext: false,
              pendingAiChoice: null,
              pendingAiAt: null,
            },
          });

          await tx.gameParticipant.updateMany({
            where: { roomId, isAI: true },
            data: { ready: true },
          });

          await tx.gameRoom.update({
            where: { id: roomId },
            data: {
              status: "lobby",
              phase: "lobby",
              currentQuestionIndex: 0,
              phaseStartedAt: null,
              phaseEndsAt: null,
              endedAt: null,
              stateVersion: { increment: 1 },
            },
          });
          break;
        }

        case "leave": {
          if (player.isHost || room.status === "playing") {
            await tx.gameRoom.update({
              where: { id: roomId },
              data: {
                status: "abandoned",
                phase: "abandoned",
                endedAt: now,
                phaseEndsAt: null,
                stateVersion: { increment: 1 },
              },
            });
          } else {
            await tx.gameParticipant.delete({
              where: { id: player.id },
            });
            return null;
          }
          break;
        }

        default:
          throw new GameActionError("Unsupported game action.");
      }

      await tickRoom(tx, roomId, now);

      await tx.gameRoom.update({
        where: { id: roomId },
        data: { stateVersion: { increment: 1 } },
      });

      return buildGameSnapshot(tx, roomId, userId);
    },
    {
      maxWait: 5000,
      timeout: 15000,
    }
  );

  // The database commit is authoritative. If Realtime delivery fails,
  // clients can still recover using the snapshot endpoint.
  try {
    await broadcastRoomEvent(roomId, "state_changed", {
      roomId,
      at: Date.now(),
    });
  } catch (error) {
    console.error("[Game Realtime broadcast]", error);
  }

  return snapshot;
}
