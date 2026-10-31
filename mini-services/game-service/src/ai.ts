// STUDY CLASH — server-side AI opponent
// The AI participates in the real scoring pipeline: it answers the same
// questions through the same submission path as humans, with a realistic
// response delay. Accuracy and speed depend on the selected AI level and are
// modulated by quiz difficulty. The AI never uses abilities and never sees
// anything a human opponent wouldn't (its "knowledge" is the accuracy roll).

import type { AILevel } from "./constants";

interface AIParams {
  baseAccuracy: number;
  delayMinMs: number;
  delayMaxMs: number;
  timeoutChance: number; // chance the bot is too slow and times out
}

const AI_PARAMS: Record<AILevel, AIParams> = {
  EASY: { baseAccuracy: 0.38, delayMinMs: 4000, delayMaxMs: 9500, timeoutChance: 0.15 },
  MID: { baseAccuracy: 0.58, delayMinMs: 3000, delayMaxMs: 8000, timeoutChance: 0.05 },
  HARD: { baseAccuracy: 0.78, delayMinMs: 2000, delayMaxMs: 6500, timeoutChance: 0.0 },
  GENIUS: { baseAccuracy: 0.95, delayMinMs: 1200, delayMaxMs: 4800, timeoutChance: 0.0 },
};

const DIFFICULTY_OFFSET: Record<string, number> = {
  EASY: 0.06,
  NORMAL: 0.0,
  HARD: -0.07,
};

export interface AiDecision {
  correct: boolean;
  delayMs: number;
}

export function decideAiAnswer(level: string, quizDifficulty: string, timerMs: number): AiDecision {
  const params = AI_PARAMS[level as AILevel] ?? AI_PARAMS.MID;
  const offset = DIFFICULTY_OFFSET[quizDifficulty] ?? 0;
  const accuracy = Math.min(0.97, Math.max(0.15, params.baseAccuracy + offset));

  const roll = Math.random();
  const correct = roll < accuracy;

  let delayMs = params.delayMinMs + Math.random() * (params.delayMaxMs - params.delayMinMs);
  // Faster when it "knows", slower when guessing — realistic behavior.
  if (correct) delayMs *= 0.85;
  else delayMs *= 1.1;

  const timeout = Math.random() < params.timeoutChance && level === "EASY";
  if (timeout) {
    delayMs = timerMs + 400; // the bot runs out of time
  }
  return { correct, delayMs: Math.round(delayMs) };
}

/** Pick the bot's choice index: the correct one, or a random wrong one. */
export function pickAiChoice(correct: boolean, correctIndex: number): number {
  if (correct) return correctIndex;
  const wrong = [0, 1, 2, 3].filter((i) => i !== correctIndex);
  return wrong[Math.floor(Math.random() * wrong.length)];
}
