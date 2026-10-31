// STUDY CLASH — scoring rules (shared client + game service)
// Classic quiz scoring: base points for a correct answer plus a speed bonus
// that decays linearly with time. All scoring is computed SERVER-SIDE only;
// this module is imported by the game service and used for display constants.

import type { AbilityId } from "./characters";

export const BASE_POINTS = 100;
export const MAX_SPEED_BONUS = 100;
export const REVEAL_SECONDS = 7;
export const COUNTDOWN_SECONDS = 3;
export const SPRINTER_EXTRA_MS = 5000;

/** Ability bonuses (points, granted only when the answer is correct). */
export const ABILITY_BONUS: Partial<Record<AbilityId, number>> = {
  focus_mode: 100,
  double_down: 150,
  lucky_break: 75,
};

export interface QuestionScoreInput {
  correct: boolean;
  timeMs: number; // time taken by the player
  timerMs: number; // total time limit for this question
  armedAbility?: AbilityId | null; // ability armed for this question
}

export interface QuestionScore {
  base: number;
  speedBonus: number;
  abilityBonus: number;
  total: number;
}

export function computeQuestionScore(input: QuestionScoreInput): QuestionScore {
  if (!input.correct) {
    return { base: 0, speedBonus: 0, abilityBonus: 0, total: 0 };
  }
  const timerMs = Math.max(1, input.timerMs);
  const timeMs = Math.max(0, Math.min(input.timeMs, timerMs));
  const speedBonus = Math.round(
    MAX_SPEED_BONUS * Math.max(0, 1 - timeMs / timerMs)
  );
  const abilityBonus =
    input.armedAbility && ABILITY_BONUS[input.armedAbility]
      ? (ABILITY_BONUS[input.armedAbility] as number)
      : 0;
  return {
    base: BASE_POINTS,
    speedBonus,
    abilityBonus,
    total: BASE_POINTS + speedBonus + abilityBonus,
  };
}
