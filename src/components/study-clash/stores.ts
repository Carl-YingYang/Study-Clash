"use client";

// Study Clash client stores: view router + realtime game state.
import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type {
  RoomStatePayload,
  QuestionPayload,
  RoundResultPayload,
  GameOverPayload,
} from "@/lib/types";

export type View =
  | "landing"
  | "auth"
  | "dashboard"
  | "library"
  | "clash"
  | "practice"
  | "lobby"
  | "game"
  | "results"
  | "leaderboard"
  | "profile"
  | "settings";

interface RouterState {
  view: View;
  params: Record<string, string>;
  go: (view: View, params?: Record<string, string>) => void;
}

export const useRouterStore = create<RouterState>((set) => ({
  view: "landing",
  params: {},
  go: (view, params = {}) => set({ view, params }),
}));

export interface AbilityEffectPayload {
  ability: string;
  eliminated?: number[];
  endsAt?: number;
  addedMs?: number;
  armed?: boolean;
}

interface GameStore {
  socket: Socket | null;
  connected: boolean;
  clockOffset: number;
  token: string | null;
  roomState: RoomStatePayload | null;
  countdown: number | null;
  question: QuestionPayload | null;
  myAnswer: { choiceIndex: number } | null;
  opponentAnswered: string[];
  roundResult: RoundResultPayload | null;
  gameOver: GameOverPayload | null;
  eliminated: number[];
  abilityEffect: AbilityEffectPayload | null;
  abilityToast: { pid: string; name: string; ability: string } | null;
  abandoned: string | null;
  authError: string | null;
  connectError: string | null;
  lastError: string | null;

  connect: (token: string) => void;
  disconnect: () => void;
  clearTransient: () => void;
  setReady: (value: boolean) => void;
  selectCharacter: (characterId: string) => void;
  start: () => void;
  submitAnswer: (index: number, choiceIndex: number) => void;
  activateAbility: () => void;
  next: () => void;
  rematch: () => void;
  leave: () => void;
}

function attachHandlers(socket: Socket) {
  const store = useGameStore;

  socket.on("hello", (p: { serverTime: number }) => {
    store.setState({ clockOffset: p.serverTime - Date.now(), connected: true });
  });

  socket.on("connect", () => {
    store.setState({ connected: true });
  });

  socket.on("disconnect", () => {
    store.setState({ connected: false });
  });

  socket.on("roomState", (p: RoomStatePayload) => {
    store.setState({ roomState: p, connectError: null });
  });

  socket.on("countdown", (p: { value: number }) => {
    store.setState({ countdown: p.value });
  });

  socket.on("question", (p: QuestionPayload & { eliminated?: number[] | null }) => {
    store.setState({
      question: p,
      myAnswer: p.youAnswered !== null && p.youAnswered !== undefined ? { choiceIndex: p.youAnswered } : null,
      roundResult: null,
      eliminated: p.eliminated ?? [],
      abilityEffect: null,
      countdown: null,
      opponentAnswered: [],
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sc:question"));
    }
  });

  socket.on("answerAccepted", (p: { index: number; choiceIndex: number }) => {
    const q = store.getState().question;
    if (q && p.index === q.index) {
      store.setState({ myAnswer: { choiceIndex: p.choiceIndex } });
    }
  });

  socket.on("answerRejected", (p: { reason: string }) => {
    store.setState({ lastError: p.reason });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sc:error", { detail: p.reason }));
    }
  });

  socket.on("opponentAnswered", (p: { pid: string; index: number }) => {
    const q = store.getState().question;
    if (q && p.index === q.index) {
      store.setState((s) => ({
        opponentAnswered: s.opponentAnswered.includes(p.pid)
          ? s.opponentAnswered
          : [...s.opponentAnswered, p.pid],
      }));
    }
  });

  socket.on("abilityEffect", (p: AbilityEffectPayload) => {
    store.setState((s) => ({
      abilityEffect: p,
      eliminated: p.eliminated ? p.eliminated : s.eliminated,
    }));
  });

  socket.on("abilityUsed", (p: { pid: string; name: string; ability: string }) => {
    store.setState({ abilityToast: p });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("sc:ability-used", { detail: `${p.name} used an ability` })
      );
    }
  });

  socket.on("roundResult", (p: RoundResultPayload) => {
    store.setState({ roundResult: p, question: null, myAnswer: null });
  });

  socket.on("gameOver", (p: GameOverPayload) => {
    store.setState({ gameOver: p, question: null, roundResult: null, countdown: null });
    useRouterStore.getState().go("results");
  });

  socket.on("abandoned", (p: { reason: string }) => {
    store.setState({ abandoned: p.reason });
    const sock = store.getState().socket;
    sock?.disconnect();
    store.setState({ socket: null, connected: false, question: null, roundResult: null });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sc:abandoned", { detail: p.reason }));
    }
  });

  socket.on("authError", (p: { message: string }) => {
    store.setState({ authError: p.message });
  });

  socket.on("error", (p: { message: string }) => {
    store.setState({ lastError: p.message });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sc:error", { detail: p.message }));
    }
  });

  socket.on("superseded", () => {
    store.setState({ authError: "You opened this match in another tab." });
  });
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  connected: false,
  clockOffset: 0,
  token: null,
  roomState: null,
  countdown: null,
  question: null,
  myAnswer: null,
  opponentAnswered: [],
  roundResult: null,
  gameOver: null,
  eliminated: [],
  abilityEffect: null,
  abilityToast: null,
  abandoned: null,
  authError: null,
  connectError: null,
  lastError: null,

  
connect: (token) => {
  const existing = get().socket;

  if (existing) {
    existing.removeAllListeners();
    existing.disconnect();
  }

  const gameServiceUrl =
    process.env.NEXT_PUBLIC_GAME_SERVICE_URL ||
    "/?XTransformPort=3001";

  const socket = io(gameServiceUrl, {
    path: "/",
    transports: ["websocket", "polling"],
    auth: { token },
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  attachHandlers(socket);

  set({
    socket,
    token,
    connected: false,
    roomState: null,
    question: null,
    myAnswer: null,
    roundResult: null,
    gameOver: null,
    countdown: null,
    eliminated: [],
    abilityEffect: null,
    abilityToast: null,
    abandoned: null,
    authError: null,
    connectError: null,
    opponentAnswered: [],
  });
    // Escape hatch: if the server never acknowledges us, surface a clear
    // error instead of spinning forever.
    window.setTimeout(() => {
      const s = useGameStore.getState();
      if (s.socket === socket && !s.roomState && !s.authError && !s.abandoned) {
        useGameStore.setState({
          connectError: s.connected
            ? "Connected but the room did not respond. It may have been closed."
            : "Could not reach the game server. Check your connection and try again.",
        });
      }
    }, 12_000);
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    set({
      socket: null,
      connected: false,
      token: null,
      roomState: null,
      question: null,
      myAnswer: null,
      roundResult: null,
      gameOver: null,
      countdown: null,
      eliminated: [],
      abilityEffect: null,
      abandoned: null,
      connectError: null,
      opponentAnswered: [],
    });
  },

  clearTransient: () => {
    set({
      question: null,
      myAnswer: null,
      roundResult: null,
      countdown: null,
      eliminated: [],
      abilityEffect: null,
      abandoned: null,
      opponentAnswered: [],
      lastError: null,
    });
  },

  setReady: (value) => get().socket?.emit("ready", { value }),
  selectCharacter: (characterId) => get().socket?.emit("character", { characterId }),
  start: () => get().socket?.emit("start"),
  submitAnswer: (index, choiceIndex) =>
    get().socket?.emit("answer", { index, choiceIndex }),
  activateAbility: () => get().socket?.emit("ability"),
  next: () => get().socket?.emit("next"),
  rematch: () => get().socket?.emit("rematch"),
  leave: () => get().socket?.emit("leave"),
}));
