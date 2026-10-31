// Scoring constants + ability table (mirrors src/lib/scoring.ts in the web app)

export const BASE_POINTS = 100;
export const MAX_SPEED_BONUS = 100;
export const REVEAL_SECONDS = 7;
export const COUNTDOWN_SECONDS = 3;
export const SPRINTER_EXTRA_MS = 5000;

export type AbilityId =
  | "second_chance"
  | "focus_mode"
  | "quick_reflex"
  | "double_down"
  | "lucky_break";

export const ABILITY_BONUS: Partial<Record<AbilityId, number>> = {
  focus_mode: 100,
  double_down: 150,
  lucky_break: 75,
};

export function computeQuestionScore(input: {
  correct: boolean;
  timeMs: number;
  timerMs: number;
  armedAbility?: AbilityId | null;
}): { base: number; speedBonus: number; abilityBonus: number; total: number } {
  if (!input.correct) return { base: 0, speedBonus: 0, abilityBonus: 0, total: 0 };
  const timerMs = Math.max(1, input.timerMs);
  const timeMs = Math.max(0, Math.min(input.timeMs, timerMs));
  const speedBonus = Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - timeMs / timerMs));
  const abilityBonus =
    input.armedAbility && ABILITY_BONUS[input.armedAbility]
      ? (ABILITY_BONUS[input.armedAbility] as number)
      : 0;
  return { base: BASE_POINTS, speedBonus, abilityBonus, total: BASE_POINTS + speedBonus + abilityBonus };
}

export const CHARACTER_ABILITY: Record<string, AbilityId> = {
  thinker: "second_chance",
  scholar: "focus_mode",
  sprinter: "quick_reflex",
  trickster: "double_down",
  wildcard: "lucky_break",
};

export const VALID_CHARACTERS = ["thinker", "scholar", "sprinter", "trickster", "wildcard"];
