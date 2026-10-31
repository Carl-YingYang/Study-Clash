// STUDY CLASH — character definitions (shared client + game service)
// The five 3D figurine models are cosmetic identities with one balanced
// strategic ability each. No RPG stats, no combat, no progression.

export type CharacterId = "thinker" | "scholar" | "sprinter" | "trickster" | "wildcard";

export type AbilityId =
  | "second_chance" // Thinker — remove two wrong choices
  | "focus_mode" // Scholar — +100 if next answer correct
  | "quick_reflex" // Sprinter — +5s on current question (own timer)
  | "double_down" // Trickster — +150 if current answer correct, else 0
  | "lucky_break"; // Wildcard — +75 if next answer correct

export interface CharacterDef {
  id: CharacterId;
  name: string;
  title: string;
  model: string; // public .glb path
  color: string; // hex accent
  icon: string; // lucide icon key (mapped in client)
  personality: string;
  ability: {
    id: AbilityId;
    name: string;
    description: string;
    bonus: number; // points granted when the condition is met
    timing: "before_answer" | "before_answer_or_timer";
  };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "thinker",
    name: "The Thinker",
    title: "Second Chance",
    model: "/models/thinker.glb",
    color: "#355CFF",
    icon: "brain",
    personality:
      "Calm, methodical, never rushes. The Thinker eliminates noise before committing to an answer.",
    ability: {
      id: "second_chance",
      name: "Second Chance",
      description:
        "Removes two incorrect choices from the current question. Never reveals the correct answer.",
      bonus: 0,
      timing: "before_answer",
    },
  },
  {
    id: "scholar",
    name: "The Scholar",
    title: "Focus Mode",
    model: "/models/scholar.glb",
    color: "#D9CCFF",
    icon: "graduation-cap",
    personality:
      "Prepared, patient, quietly confident. The Scholar reads twice and answers once.",
    ability: {
      id: "focus_mode",
      name: "Focus Mode",
      description:
        "Arms a +100 point bonus that is granted if your next answer is correct. No bonus if you miss.",
      bonus: 100,
      timing: "before_answer_or_timer",
    },
  },
  {
    id: "sprinter",
    name: "The Sprinter",
    title: "Quick Reflex",
    model: "/models/sprinter.glb",
    color: "#B9F7D0",
    icon: "zap",
    personality:
      "Fast, instinctive, allergic to waiting. The Sprinter buys time when the clock is the enemy.",
    ability: {
      id: "quick_reflex",
      name: "Quick Reflex",
      description:
        "Adds 5 seconds to your timer for the current question. Must be used before time runs out.",
      bonus: 0,
      timing: "before_answer_or_timer",
    },
  },
  {
    id: "trickster",
    name: "The Trickster",
    title: "Double Down",
    model: "/models/trickster.glb",
    color: "#FF6B6B",
    icon: "dices",
    personality:
      "Bold, playful, allergic to safe plays. The Trickster raises the stakes on a single question.",
    ability: {
      id: "double_down",
      name: "Double Down",
      description:
        "A correct answer on the current question earns a +150 bonus. A wrong answer earns zero — you never lose points you already have.",
      bonus: 150,
      timing: "before_answer",
    },
  },
  {
    id: "wildcard",
    name: "The Wildcard",
    title: "Lucky Break",
    model: "/models/wildcard.glb",
    color: "#171717",
    icon: "sparkles",
    personality:
      "Unpredictable, charming, statistically inconvenient. The Wildcard stacks small edges.",
    ability: {
      id: "lucky_break",
      name: "Lucky Break",
      description:
        "Arms a +75 point bonus that is granted if your next answer is correct. A small, reliable edge.",
      bonus: 75,
      timing: "before_answer_or_timer",
    },
  },
];

export const CHARACTER_IDS: CharacterId[] = CHARACTERS.map((c) => c.id);

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function isValidCharacterId(id: string): id is CharacterId {
  return CHARACTER_IDS.includes(id as CharacterId);
}

// AI opponent identities in Practice Mode (cosmetic only, never uses abilities)
export const AI_LEVELS = ["EASY", "MID", "HARD", "GENIUS"] as const;
export type AILevel = (typeof AI_LEVELS)[number];

export function isValidAiLevel(level: string): level is AILevel {
  return (AI_LEVELS as readonly string[]).includes(level);
}

export const AI_LEVEL_META: Record<
  AILevel,
  { label: string; characterId: CharacterId; blurb: string }
> = {
  EASY: {
    label: "Easy Bot",
    characterId: "scholar",
    blurb: "Makes frequent mistakes and answers slowly. Great for warming up.",
  },
  MID: {
    label: "Mid Bot",
    characterId: "sprinter",
    blurb: "Handles straightforward questions, stumbles on harder ones.",
  },
  HARD: {
    label: "Hard Bot",
    characterId: "thinker",
    blurb: "Highly accurate and consistent. You will need to know the material.",
  },
  GENIUS: {
    label: "Genius Bot",
    characterId: "trickster",
    blurb: "Rarely misses and answers fast. A serious challenge.",
  },
};

export const QUIZ_DIFFICULTIES = ["EASY", "NORMAL", "HARD"] as const;
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number];

export const QUESTION_COUNTS = [10, 20, 30] as const;
export const TIMER_OPTIONS = [10, 15, 20] as const;
