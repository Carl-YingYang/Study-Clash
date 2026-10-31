// STUDY CLASH — shared API payload types (client-facing only; these types
// intentionally never contain answer keys).

import type { CharacterId, AILevel, QuizDifficulty } from "./characters";

export interface SessionUser {
  id: string;
  name?: string | null;
  characterId: CharacterId;
}

export interface DocumentSummary {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: "pdf" | "docx" | "pptx";
  status: "processing" | "ready" | "failed" | "insufficient";
  textChars: number;
  pageCount: number;
  error: string | null;
  createdAt: string;
  quizzes: QuizSummary[];
}

export interface QuizSummary {
  id: string;
  documentId: string;
  documentName: string;
  questionCount: number;
  difficulty: QuizDifficulty;
  status: "generating" | "ready" | "failed" | "insufficient";
  error: string | null;
  createdAt: string;
}

export interface RoomInfo {
  code: string;
  mode: "CLASH" | "PRACTICE";
  status: "lobby" | "playing" | "finished" | "abandoned";
  questionCount: number;
  difficulty: QuizDifficulty;
  timerSeconds: number;
  aiLevel: AILevel | null;
  documentName: string;
  hostName: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  characterId: CharacterId;
  totalPoints: number;
  accuracy: number; // 0..1
  games: number;
  wins: number;
  bestScore: number;
}

export interface ProfileStats {
  username: string;
  characterId: CharacterId;
  memberSince: string;
  totalGames: number;
  clashGames: number;
  clashWins: number;
  practiceGames: number;
  practiceWins: number;
  overallAccuracy: number;
  bestScore: number;
  favoriteCharacter: CharacterId | null;
  bestDifficulty: QuizDifficulty | null;
  divisionStats: Array<{
    division: number;
    games: number;
    accuracy: number;
    bestScore: number;
  }>;
  documents: number;
  quizzes: number;
  recentGames: Array<{
    id: string;
    mode: "CLASH" | "PRACTICE";
    questionCount: number;
    difficulty: QuizDifficulty;
    score: number;
    correctCount: number;
    totalQuestions: number;
    accuracy: number;
    avgTimeMs: number;
    won: boolean;
    abilityUsed: boolean;
    characterId: CharacterId;
    opponentName: string;
    finishedAt: string;
  }>;
}

// ---- Realtime payloads (socket.io) — see mini-services/game-service ----

export interface PlayerPublic {
  pid: string;
  name: string;
  characterId: CharacterId;
  isHost: boolean;
  isAI: boolean;
  aiLevel: AILevel | null;
  score: number;
  ready: boolean;
  abilityUsed: boolean;
  abilityArmed: string | null;
  connected: boolean;
  submitted: boolean;
}

export interface RoomStatePayload {
  room: RoomInfo;
  phase: "lobby" | "countdown" | "question" | "reveal" | "finished" | "abandoned";
  players: PlayerPublic[];
  you: { pid: string; isHost: boolean };
  qIndex: number;
}

export interface QuestionPayload {
  index: number; // 0-based
  total: number;
  text: string;
  choices: string[];
  difficulty: QuizDifficulty;
  timerMs: number;
  endsAt: number; // your personal deadline (server epoch ms)
  serverTime: number;
  youAnswered?: number | null;
}

export interface RoundResultPayload {
  index: number;
  text: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  sourceRef: string | null;
  results: Array<{
    pid: string;
    name: string;
    choiceIndex: number | null;
    correct: boolean;
    points: number;
    base: number;
    speedBonus: number;
    abilityBonus: number;
    timeMs: number;
  }>;
  scores: Array<{ pid: string; score: number }>;
  nextAt: number; // server epoch ms when next question starts
}

export interface GameOverReviewItem {
  index: number;
  text: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  sourceRef: string | null;
  answers: Array<{ pid: string; name: string; choiceIndex: number | null; correct: boolean; points: number }>;
}

export interface GameOverPayload {
  mode: "CLASH" | "PRACTICE";
  results: Array<{
    pid: string;
    name: string;
    characterId: CharacterId;
    isAI: boolean;
    aiLevel: AILevel | null;
    score: number;
    correctCount: number;
    totalQuestions: number;
    accuracy: number;
    avgTimeMs: number;
    abilityUsed: boolean;
    won: boolean;
  }>;
  review: GameOverReviewItem[];
  sessionId: string;
}
