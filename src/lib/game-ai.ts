
import type { AILevel } from "./characters";

interface AIParams {
  baseAccuracy: number;
  delayMinMs: number;
  delayMaxMs: number;
  timeoutChance: number;
}

const AI_PARAMS: Record<AILevel, AIParams> = {
  EASY: {
    baseAccuracy: 0.38,
    delayMinMs: 4000,
    delayMaxMs: 9500,
    timeoutChance: 0.15,
  },
  MID: {
    baseAccuracy: 0.58,
    delayMinMs: 3000,
    delayMaxMs: 8000,
    timeoutChance: 0.05,
  },
  HARD: {
    baseAccuracy: 0.78,
    delayMinMs: 2000,
    delayMaxMs: 6500,
    timeoutChance: 0,
  },
  GENIUS: {
    baseAccuracy: 0.95,
    delayMinMs: 1200,
    delayMaxMs: 4800,
    timeoutChance: 0,
  },
};

const DIFFICULTY_OFFSET: Record<string, number> = {
  EASY: 0.06,
  NORMAL: 0,
  HARD: -0.07,
};

export interface AIDecision {
  correct: boolean;
  delayMs: number;
}

export function decideAiAnswer(
  level: string,
  quizDifficulty: string,
  timerMs: number
): AIDecision {
  const params = AI_PARAMS[level as AILevel] ?? AI_PARAMS.MID;
  const offset = DIFFICULTY_OFFSET[quizDifficulty] ?? 0;

  const accuracy = Math.min(
    0.97,
    Math.max(0.15, params.baseAccuracy + offset)
  );

  const correct = Math.random() < accuracy;

  let delayMs =
    params.delayMinMs +
    Math.random() * (params.delayMaxMs - params.delayMinMs);

  if (correct) {
    delayMs *= 0.85;
  } else {
    delayMs *= 1.1;
  }

  const timeout =
    Math.random() < params.timeoutChance && level === "EASY";

  if (timeout) {
    delayMs = timerMs + 400;
  }

  return {
    correct,
    delayMs: Math.round(delayMs),
  };
}

export function pickAiChoice(
  correct: boolean,
  correctIndex: number
): number {
  if (correct) {
    return correctIndex;
  }

  const wrongChoices = [0, 1, 2, 3].filter(
    (index) => index !== correctIndex
  );

  return wrongChoices[
    Math.floor(Math.random() * wrongChoices.length)
  ];
}
