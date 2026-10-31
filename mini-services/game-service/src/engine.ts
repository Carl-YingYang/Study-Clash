// STUDY CLASH — realtime game engine
// ---------------------------------------------------------------------------
// Security model:
//  - Clients authenticate with an HMAC token issued by the Next.js API.
//  - The answer key (correctIndex) lives ONLY in this service and the DB.
//    It is never included in any payload sent before a round locks.
//  - All scoring, timers, ability validation and progression are authoritative
//    server-side. Clients only render state.
// ---------------------------------------------------------------------------
import type { Server, Socket } from "socket.io";
import { db } from "./db";
import { verifyGameToken } from "./token";
import {
  computeQuestionScore,
  REVEAL_SECONDS,
  COUNTDOWN_SECONDS,
  SPRINTER_EXTRA_MS,
  CHARACTER_ABILITY,
  VALID_CHARACTERS,
  type AbilityId,
} from "./constants";
import { decideAiAnswer, pickAiChoice } from "./ai";

const GAME_SECRET = process.env.GAME_SECRET ?? "";
const ABANDON_GRACE_MS = 30_000;
const FINISHED_ROOM_TTL_MS = 30 * 60 * 1000;
/** Lobbies older than this are considered dead (lost runtime) and retired. */
const LOBBY_STALE_MS = 2 * 60 * 60 * 1000;

interface RuntimePlayer {
  pid: string;
  uid: string | null;
  name: string;
  characterId: string;
  isHost: boolean;
  isAI: boolean;
  aiLevel: string | null;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  score: number;
  correctCount: number;
  abilityUsed: boolean;
  abilityArmed: AbilityId | null;
  eliminated: number[] | null;
  deadline: number;
  answered: { choiceIndex: number; timeMs: number } | null;
  readyForNext: boolean;
}

interface EngineQuestion {
  text: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  sourceRef: string | null;
}

type Phase = "lobby" | "countdown" | "question" | "reveal" | "finished" | "abandoned";

interface RuntimeRoom {
  id: string;
  code: string;
  mode: "CLASH" | "PRACTICE";
  quizId: string;
  questionCount: number;
  difficulty: string;
  timerMs: number;
  aiLevel: string | null;
  documentName: string;
  hostName: string;
  phase: Phase;
  players: Map<string, RuntimePlayer>;
  questions: EngineQuestion[];
  qIndex: number;
  questionStartedAt: number;
  revealEndsAt: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  abandonTimer: ReturnType<typeof setTimeout> | null;
  lastSessionId: string | null;
  createdAt: number;
}

function log(room: string, msg: string) {
  console.log(`[room ${room}] ${msg}`);
}

export class GameEngine {
  private rooms = new Map<string, RuntimeRoom>();
  private roomBuilds = new Map<string, Promise<RuntimeRoom | null>>();
  private socketRoom = new Map<string, string>();

  constructor(private io: Server) {
    // Periodic cleanup of finished/abandoned rooms.
    setInterval(() => {
      const now = Date.now();
      for (const [id, room] of this.rooms) {
        if (
          (room.phase === "finished" || room.phase === "abandoned") &&
          now - room.createdAt > FINISHED_ROOM_TTL_MS &&
          ![...room.players.values()].some((p) => p.socketId)
        ) {
          this.rooms.delete(id);
        }
      }
    }, 5 * 60 * 1000).unref?.();
  }

  // ------------------------------------------------------------------ attach

  /**
   * Returns the runtime room, building it at most once even when several
   * sockets attach concurrently (prevents duplicate-runtime races).
   */
  private ensureRuntime(roomId: string): Promise<RuntimeRoom | null> {
    const existing = this.rooms.get(roomId);
    if (existing) return Promise.resolve(existing);
    let pending = this.roomBuilds.get(roomId);
    if (!pending) {
      pending = this.buildRuntime(roomId).catch((err) => {
        console.error("buildRuntime failed", err);
        return null;
      });
      this.roomBuilds.set(roomId, pending);
      pending
        .then((room) => {
          if (room && !this.rooms.has(roomId)) this.rooms.set(roomId, room);
        })
        .catch(() => undefined)
        .finally(() => {
          this.roomBuilds.delete(roomId);
        });
    }
    return pending;
  }

  async attachSocket(socket: Socket): Promise<void> {
    const payload = verifyGameToken(socket.handshake.auth?.token, GAME_SECRET);
    if (!payload) {
      socket.emit("authError", { message: "Invalid or expired game token." });
      socket.disconnect(true);
      return;
    }

    const room = await this.ensureRuntime(payload.rid);
    if (!room) {
      socket.emit("authError", { message: "This match no longer exists." });
      socket.disconnect(true);
      return;
    }

    if (room.phase === "abandoned") {
      socket.emit("abandoned", { reason: "This match was abandoned." });
      socket.disconnect(true);
      return;
    }

    // A participant may have joined AFTER the runtime was built (e.g. a guest
    // joining a lobby where the host is already connected). Pull them in from
    // the DB instead of rejecting them.
    let player = room.players.get(payload.pid);
    if (!player || player.uid !== payload.uid) {
      player = await this.syncParticipantFromDb(room, payload.pid, payload.uid);
    }
    if (!player) {
      socket.emit("authError", { message: "You are not a participant of this match." });
      socket.disconnect(true);
      return;
    }

    // Supersede any previous socket for this participant.
    if (player.socketId && player.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.emit("superseded", { message: "You connected from another tab." });
        old.disconnect(true);
        this.socketRoom.delete(player.socketId);
      }
    }

    player.socketId = socket.id;
    player.connected = true;
    this.socketRoom.set(socket.id, room.id);
    this.clearAbandonTimer(room);

    socket.data.roomId = room.id;
    socket.data.pid = player.pid;

    socket.emit("hello", { serverTime: Date.now() });
    // Tell everyone else that this player (re)connected — e.g. lobby joins.
    this.emitOthers(room, player.pid, "playerJoined", {
      pid: player.pid,
      name: player.name,
      phase: room.phase,
    });

    // Late joiner / reconnect: catch them up.
    if (room.phase === "question") {
      const q = room.questions[room.qIndex];
      if (q) {
        socket.emit("question", {
          index: room.qIndex,
          total: room.questionCount,
          text: q.text,
          choices: q.choices,
          difficulty: room.difficulty,
          timerMs: room.timerMs,
          endsAt: player.deadline,
          serverTime: Date.now(),
          youAnswered: player.answered?.choiceIndex ?? null,
          eliminated: player.eliminated,
        });
      }
    }
    if (room.phase === "reveal") {
      // The reveal payload is broadcast on lock; a reconnecting player gets
      // roomState and will see scores on the next question. Send a compact
      // catch-up so they are not stuck on a blank screen.
      socket.emit("revealCatchup", { index: room.qIndex, nextAt: room.revealEndsAt });
    }
    if (room.phase === "finished" && room.lastSessionId) {
      await this.emitReconstructedGameOver(room, socket);
    }

    this.broadcastRoomState(room);
    log(room.code, `player ${player.name} attached (${room.phase})`);
  }

  detachSocket(socket: Socket) {
    const roomId = this.socketRoom.get(socket.id);
    if (!roomId) return;
    this.socketRoom.delete(socket.id);
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = [...room.players.values()].find((p) => p.socketId === socket.id);
    if (!player) return;
    player.socketId = null;
    player.connected = false;

    if (room.phase === "lobby") {
      if (player.isHost) {
        this.startAbandonTimer(room, "The host left the lobby.");
      } else {
        // Guests can cleanly leave a lobby (history is denormalized).
        room.players.delete(player.pid);
        db.gameParticipant
          .delete({ where: { id: player.pid } })
          .catch(() => undefined);
        this.broadcast(room, "playerLeft", { pid: player.pid, name: player.name });
        const humans = [...room.players.values()].filter((p) => !p.isAI);
        if (humans.length === 0) {
          this.abandon(room, "Everyone left the lobby.");
        }
      }
    } else if (room.phase === "countdown" || room.phase === "question" || room.phase === "reveal") {
      this.broadcast(room, "playerLeft", { pid: player.pid, name: player.name });
      this.startAbandonTimer(room, `${player.name} disconnected.`);
    }
    this.broadcastRoomState(room);
    log(room.code, `player ${player.name} detached (${room.phase})`);
  }

  // ------------------------------------------------------------- runtime ops

  /**
   * Fetch a participant row from the DB and inject it into a live runtime.
   * Returns null when the pid/uid pair does not belong to the room. This is
   * what lets guests join a lobby whose runtime was already built by the host.
   */
  private async syncParticipantFromDb(
    room: RuntimeRoom,
    pid: string,
    uid: string
  ): Promise<RuntimePlayer | null> {
    if (room.phase === "finished" || room.phase === "abandoned") return null;
    // If the pid is already in the runtime with a different uid, reject.
    if (room.players.has(pid)) return null;
    try {
      const p = await db.gameParticipant.findFirst({
        where: { id: pid, roomId: room.id, userId: uid },
      });
      if (!p) return null;
      const player: RuntimePlayer = {
        pid: p.id,
        uid: p.userId,
        name: p.displayName,
        characterId: p.characterId,
        isHost: p.isHost,
        isAI: p.isAI,
        aiLevel: p.aiLevel,
        socketId: null,
        connected: false,
        ready: p.ready,
        score: p.score,
        correctCount: p.correctCount,
        abilityUsed: p.abilityUsed,
        abilityArmed: (p.abilityActive as AbilityId | null) ?? null,
        eliminated: null,
        deadline: 0,
        answered: null,
        readyForNext: false,
      };
      room.players.set(pid, player);
      log(room.code, `participant ${p.displayName} synced into live runtime`);
      return player;
    } catch (err) {
      console.error("syncParticipantFromDb failed", err);
      return null;
    }
  }

  private async buildRuntime(roomId: string): Promise<RuntimeRoom | null> {
    const room = await db.gameRoom.findUnique({
      where: { id: roomId },
      include: {
        quiz: { include: { document: { select: { fileName: true } } } },
        host: { select: { username: true } },
        participants: true,
      },
    });
    if (!room) return null;

    let phase: Phase = "lobby";
    if (room.status === "finished") phase = "finished";
    if (room.status === "abandoned") phase = "abandoned";
    // If the service restarted mid-match, that match is over.
    if (room.status === "playing") {
      phase = "abandoned";
      await db.gameRoom
        .update({ where: { id: room.id }, data: { status: "abandoned", endedAt: new Date() } })
        .catch(() => undefined);
    }
    // Lobbies older than LOBBY_STALE_MS have no live runtime anymore (the
    // service restarted or the abandon timer was lost) — retire them so
    // nobody stays blocked with a phantom "match in progress".
    if (room.status === "lobby" && Date.now() - room.createdAt.getTime() > LOBBY_STALE_MS) {
      phase = "abandoned";
      await db.gameRoom
        .update({ where: { id: room.id }, data: { status: "abandoned", endedAt: new Date() } })
        .catch(() => undefined);
    }

    const runtime: RuntimeRoom = {
      id: room.id,
      code: room.code,
      mode: room.mode as "CLASH" | "PRACTICE",
      quizId: room.quizId,
      questionCount: room.questionCount,
      difficulty: room.difficulty,
      timerMs: room.timerSeconds * 1000,
      aiLevel: room.aiLevel,
      documentName: room.quiz.document.fileName,
      hostName: room.host.username,
      phase,
      players: new Map(),
      questions: [],
      qIndex: 0,
      questionStartedAt: 0,
      revealEndsAt: 0,
      timers: new Set(),
      abandonTimer: null,
      lastSessionId: null,
      createdAt: Date.now(),
    };

    for (const p of room.participants) {
      runtime.players.set(p.id, {
        pid: p.id,
        uid: p.userId,
        name: p.displayName,
        characterId: p.characterId,
        isHost: p.isHost,
        isAI: p.isAI,
        aiLevel: p.aiLevel,
        socketId: null,
        connected: false,
        ready: p.ready,
        score: p.score,
        correctCount: p.correctCount,
        abilityUsed: p.abilityUsed,
        abilityArmed: (p.abilityActive as AbilityId | null) ?? null,
        eliminated: null,
        deadline: 0,
        answered: null,
        readyForNext: false,
      });
    }

    if (phase === "finished") {
      const session = await db.gameSession.findFirst({
        where: { roomId: room.id },
        orderBy: { finishedAt: "desc" },
      });
      runtime.lastSessionId = session?.id ?? null;
      await this.loadQuestions(runtime);
    }

    return runtime;
  }

  private async loadQuestions(room: RuntimeRoom): Promise<boolean> {
    const rows = await db.question.findMany({
      where: { quizId: room.quizId },
      orderBy: { order: "asc" },
    });
    room.questions = rows.map((q) => ({
      text: q.text,
      choices: JSON.parse(q.choices) as string[],
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceRef: q.sourceRef,
    }));
    return room.questions.length >= room.questionCount;
  }

  // -------------------------------------------------------------- broadcasts

  private broadcast(room: RuntimeRoom, event: string, payload: unknown) {
    for (const p of room.players.values()) {
      if (p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private emitTo(room: RuntimeRoom, pid: string, event: string, payload: unknown) {
    const p = room.players.get(pid);
    if (p?.socketId) this.io.to(p.socketId).emit(event, payload);
  }

  private emitOthers(room: RuntimeRoom, pid: string, event: string, payload: unknown) {
    for (const p of room.players.values()) {
      if (p.pid !== pid && p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private roomInfo(room: RuntimeRoom) {
    return {
      code: room.code,
      mode: room.mode,
      status: room.phase === "abandoned" ? "abandoned" : room.phase === "finished" ? "finished" : room.phase === "lobby" ? "lobby" : "playing",
      questionCount: room.questionCount,
      difficulty: room.difficulty,
      timerSeconds: room.timerMs / 1000,
      aiLevel: room.aiLevel,
      documentName: room.documentName,
      hostName: room.hostName,
    };
  }

  private playerPublic(p: RuntimePlayer) {
    return {
      pid: p.pid,
      name: p.name,
      characterId: p.characterId,
      isHost: p.isHost,
      isAI: p.isAI,
      aiLevel: p.aiLevel,
      score: p.score,
      ready: p.ready,
      abilityUsed: p.abilityUsed,
      abilityArmed: p.abilityArmed,
      connected: p.connected,
      submitted: p.answered !== null,
    };
  }

  private broadcastRoomState(room: RuntimeRoom) {
    for (const p of room.players.values()) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit("roomState", {
        room: this.roomInfo(room),
        phase: room.phase,
        players: [...room.players.values()].map((x) => this.playerPublic(x)),
        you: { pid: p.pid, isHost: p.isHost },
        qIndex: room.qIndex,
      });
    }
  }

  // ------------------------------------------------------------------ timers

  private addTimer(room: RuntimeRoom, t: ReturnType<typeof setTimeout>) {
    room.timers.add(t);
  }

  private clearTimers(room: RuntimeRoom) {
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
  }

  private startAbandonTimer(room: RuntimeRoom, reason: string) {
    if (room.abandonTimer) clearTimeout(room.abandonTimer);
    room.abandonTimer = setTimeout(() => {
      room.abandonTimer = null;
      this.abandon(room, reason);
    }, ABANDON_GRACE_MS);
  }

  private clearAbandonTimer(room: RuntimeRoom) {
    if (room.abandonTimer) {
      clearTimeout(room.abandonTimer);
      room.abandonTimer = null;
    }
  }

  private abandon(room: RuntimeRoom, reason: string) {
    if (room.phase === "finished" || room.phase === "abandoned") return;
    this.clearTimers(room);
    this.clearAbandonTimer(room);
    room.phase = "abandoned";
    this.broadcast(room, "abandoned", { reason });
    this.broadcastRoomState(room);
    db.gameRoom
      .update({ where: { id: room.id }, data: { status: "abandoned", endedAt: new Date() } })
      .catch((e) => console.error("abandon db error", e));
    log(room.code, `abandoned: ${reason}`);
  }

  /**
   * Escape hatch used by the Next.js leave API: abandon a room by id and
   * notify every connected socket immediately.
   */
  forceAbandon(roomId: string, reason: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.abandon(room, reason);
    // Drop every live socket for this room — the match is over.
    for (const p of room.players.values()) {
      if (p.socketId) {
        const sock = this.io.sockets.sockets.get(p.socketId);
        this.socketRoom.delete(p.socketId);
        p.socketId = null;
        p.connected = false;
        sock?.disconnect(true);
      }
    }
  }

  // ------------------------------------------------------------ event layer

  private ctx(socket: Socket): { room: RuntimeRoom; player: RuntimePlayer } | null {
    const roomId = socket.data.roomId as string | undefined;
    const pid = socket.data.pid as string | undefined;
    if (!roomId || !pid) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.get(pid);
    if (!player) return null;
    return { room, player };
  }

  handleSync(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.socketId) {
      this.io.to(player.socketId).emit("roomState", {
        room: this.roomInfo(room),
        phase: room.phase,
        players: [...room.players.values()].map((x) => this.playerPublic(x)),
        you: { pid: player.pid, isHost: player.isHost },
        qIndex: room.qIndex,
      });
    }
  }

  handleCharacter(socket: Socket, data: { characterId?: string }) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const characterId = String(data?.characterId ?? "");
    if (!VALID_CHARACTERS.includes(characterId)) {
      this.emitTo(room, player.pid, "error", { message: "Unknown character." });
      return;
    }
    if (room.phase !== "lobby" && room.phase !== "finished") {
      this.emitTo(room, player.pid, "error", { message: "Characters are locked once the match starts." });
      return;
    }
    player.characterId = characterId;
    player.abilityUsed = false; // fresh ability with a fresh character before start
    player.abilityArmed = null;
    db.gameParticipant
      .update({ where: { id: player.pid }, data: { characterId, abilityUsed: false, abilityActive: null } })
      .catch(() => undefined);
    this.broadcastRoomState(room);
  }

  handleReady(socket: Socket, data: { value?: boolean }) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== "lobby") {
      this.emitTo(room, player.pid, "error", { message: "The match is not in the lobby." });
      return;
    }
    player.ready = Boolean(data?.value);
    db.gameParticipant.update({ where: { id: player.pid }, data: { ready: player.ready } }).catch(() => undefined);
    this.broadcastRoomState(room);
  }

  async handleStart(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isHost) {
      this.emitTo(room, player.pid, "error", { message: "Only the host can start the match." });
      return;
    }
    if (room.phase !== "lobby") {
      this.emitTo(room, player.pid, "error", { message: "The match has already started." });
      return;
    }
    const humans = [...room.players.values()].filter((p) => !p.isAI);
    if (humans.some((p) => !p.ready)) {
      this.emitTo(room, player.pid, "error", { message: "All players must be ready first." });
      return;
    }
    if (room.mode === "CLASH" && humans.length < 2) {
      this.emitTo(room, player.pid, "error", { message: "Waiting for an opponent to join the room." });
      return;
    }

    if (room.questions.length === 0) {
      const ok = await this.loadQuestions(room);
      if (!ok) {
        this.emitTo(room, player.pid, "error", { message: "Quiz questions could not be loaded." });
        return;
      }
    }

    // Full reset (covers both fresh starts and rematches).
    for (const p of room.players.values()) {
      p.score = 0;
      p.correctCount = 0;
      p.ready = false;
      p.abilityUsed = false;
      p.abilityArmed = null;
      p.answered = null;
      p.eliminated = null;
      p.readyForNext = false;
    }
    room.qIndex = 0;
    await db.gameParticipant.updateMany({
      where: { roomId: room.id },
      data: { score: 0, correctCount: 0, ready: false, abilityUsed: false, abilityActive: null },
    }).catch(() => undefined);
    await db.gameRoom.update({ where: { id: room.id }, data: { status: "playing" } }).catch(() => undefined);
    await db.playerAnswer.deleteMany({
      where: { participant: { roomId: room.id } },
    }).catch(() => undefined);

    this.runCountdown(room);
  }

  private runCountdown(room: RuntimeRoom) {
    this.clearTimers(room);
    this.clearAbandonTimer(room);
    room.phase = "countdown";
    this.broadcastRoomState(room);
    let n = COUNTDOWN_SECONDS;
    const tick = () => {
      this.broadcast(room, "countdown", { value: n });
      n -= 1;
      if (n >= 1) {
        this.addTimer(room, setTimeout(tick, 1000));
      } else {
        this.addTimer(room, setTimeout(() => this.startQuestion(room, 0), 1000));
      }
    };
    tick();
  }

  // -------------------------------------------------------------- questions

  private startQuestion(room: RuntimeRoom, index: number) {
    const q = room.questions[index];
    if (!q) {
      this.abandon(room, "Quiz data missing.");
      return;
    }
    this.clearTimers(room);
    room.phase = "question";
    room.qIndex = index;
    room.questionStartedAt = Date.now();

    for (const p of room.players.values()) {
      p.answered = null;
      p.eliminated = null;
      p.readyForNext = false;
      p.deadline = room.questionStartedAt + room.timerMs;
    }

    this.broadcastRoomState(room);

    for (const p of room.players.values()) {
      if (p.isAI) {
        this.scheduleAi(room, p, q, index);
      } else if (p.socketId) {
        this.io.to(p.socketId).emit("question", {
          index,
          total: room.questionCount,
          text: q.text,
          choices: q.choices,
          difficulty: room.difficulty,
          timerMs: room.timerMs,
          endsAt: p.deadline,
          serverTime: Date.now(),
          youAnswered: null,
          eliminated: null,
        });
      }
    }

    this.addTimer(
      room,
      setTimeout(() => this.attemptLock(room), room.timerMs + 250)
    );
    log(room.code, `question ${index + 1}/${room.questionCount} started`);
  }

  private scheduleAi(room: RuntimeRoom, bot: RuntimePlayer, q: EngineQuestion, index: number) {
    const decision = decideAiAnswer(bot.aiLevel ?? "MID", room.difficulty, room.timerMs);
    const delay = Math.min(decision.delayMs, room.timerMs + 600);
    this.addTimer(
      room,
      setTimeout(() => {
        if (room.phase !== "question" || room.qIndex !== index) return;
        if (bot.answered) return;
        const choiceIndex = pickAiChoice(decision.correct, q.correctIndex);
        this.submitAnswer(room, bot, choiceIndex);
      }, delay)
    );
  }

  handleSubmit(socket: Socket, data: { index?: number; choiceIndex?: number }) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== "question" || room.qIndex !== Number(data?.index)) {
      this.emitTo(room, player.pid, "answerRejected", { reason: "Question is no longer active." });
      return;
    }
    const choiceIndex = Number(data?.choiceIndex);
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 3) {
      this.emitTo(room, player.pid, "answerRejected", { reason: "Invalid choice." });
      return;
    }
    const accepted = this.submitAnswer(room, player, choiceIndex);
    if (!accepted) {
      this.emitTo(room, player.pid, "answerRejected", { reason: "Answer already locked or time is up." });
    }
  }

  private submitAnswer(room: RuntimeRoom, player: RuntimePlayer, choiceIndex: number): boolean {
    if (room.phase !== "question") return false;
    if (player.answered) return false; // duplicate submission
    if (Date.now() > player.deadline) return false; // expired for this player
    if (player.eliminated && player.eliminated.includes(choiceIndex)) return false;

    const timeMs = Math.max(0, Date.now() - room.questionStartedAt);
    player.answered = { choiceIndex, timeMs };
    player.readyForNext = false;

    this.emitTo(room, player.pid, "answerAccepted", { index: room.qIndex, choiceIndex });
    this.emitOthers(room, player.pid, "opponentAnswered", { pid: player.pid, index: room.qIndex });
    log(room.code, `${player.name} answered q${room.qIndex + 1} (${timeMs}ms)`);
    this.attemptLock(room);
    return true;
  }

  /** Lock the round once every player has answered or their deadline passed. */
  private attemptLock(room: RuntimeRoom) {
    if (room.phase !== "question") return;
    const now = Date.now();
    const pending = [...room.players.values()].filter((p) => !p.answered && p.deadline > now);
    if (pending.length > 0) {
      const next = Math.min(...pending.map((p) => p.deadline));
      this.addTimer(room, setTimeout(() => this.attemptLock(room), Math.max(60, next - Date.now() + 200)));
      return;
    }
    this.lockRound(room);
  }

  private lockRound(room: RuntimeRoom) {
    if (room.phase !== "question") return;
    room.phase = "reveal";
    this.clearTimers(room);

    const q = room.questions[room.qIndex];
    const results: Array<Record<string, unknown>> = [];

    for (const p of room.players.values()) {
      const answered = p.answered;
      const choiceIndex = answered?.choiceIndex ?? null;
      const correct = choiceIndex !== null && choiceIndex === q.correctIndex;
      const armed = p.abilityArmed;
      const timeMs = answered ? answered.timeMs : room.timerMs;
      const score = computeQuestionScore({
        correct,
        timeMs,
        timerMs: room.timerMs,
        armedAbility: armed,
      });
      p.abilityArmed = null;
      if (correct) {
        p.score += score.total;
        p.correctCount += 1;
      }
      results.push({
        pid: p.pid,
        name: p.name,
        choiceIndex,
        correct,
        points: score.total,
        base: score.base,
        speedBonus: score.speedBonus,
        abilityBonus: score.abilityBonus,
        timeMs,
      });

      // Persist (server-authoritative record of every answer).
      db.playerAnswer
        .upsert({
          where: { participantId_questionIndex: { participantId: p.pid, questionIndex: room.qIndex } },
          create: {
            participantId: p.pid,
            questionIndex: room.qIndex,
            choiceIndex,
            timeMs,
            correct,
            points: score.total,
            abilityBonus: score.abilityBonus,
          },
          update: { choiceIndex, timeMs, correct, points: score.total, abilityBonus: score.abilityBonus },
        })
        .catch((e) => console.error("answer persist error", e));
      db.gameParticipant
        .update({ where: { id: p.pid }, data: { score: p.score, correctCount: p.correctCount, abilityActive: null } })
        .catch(() => undefined);
    }

    room.revealEndsAt = Date.now() + REVEAL_SECONDS * 1000;
    // Answer key is only revealed AFTER the round is locked. The question text
    // and choices are already public (both players just saw them).
    this.broadcast(room, "roundResult", {
      index: room.qIndex,
      text: q.text,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      results,
      scores: [...room.players.values()].map((p) => ({ pid: p.pid, score: p.score })),
      nextAt: room.revealEndsAt,
    });
    this.broadcastRoomState(room);
    this.addTimer(room, setTimeout(() => this.advance(room), REVEAL_SECONDS * 1000));
    log(room.code, `round ${room.qIndex + 1} locked`);
  }

  handleNext(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== "reveal") return;
    player.readyForNext = true;
    const deciders = [...room.players.values()].filter((p) => !p.isAI && p.connected);
    if (deciders.length > 0 && deciders.every((p) => p.readyForNext)) {
      this.clearTimers(room);
      this.advance(room);
    }
  }

  private advance(room: RuntimeRoom) {
    if (room.phase !== "reveal") return;
    if (room.qIndex + 1 < room.questionCount) {
      this.startQuestion(room, room.qIndex + 1);
    } else {
      void this.finishGame(room);
    }
  }

  // ----------------------------------------------------------------- results

  private async finishGame(room: RuntimeRoom) {
    if (room.phase === "finished") return;
    this.clearTimers(room);
    this.clearAbandonTimer(room);
    room.phase = "finished";

    const players = [...room.players.values()];
    const pids = players.map((p) => p.pid);
    const answers = await db.playerAnswer.findMany({ where: { participantId: { in: pids } } });

    const maxScore = Math.max(...players.map((p) => p.score), 0);
    const topCount = players.filter((p) => p.score === maxScore && maxScore > 0).length;

    const session = await db.gameSession.create({
      data: {
        roomId: room.id,
        mode: room.mode,
        questionCount: room.questionCount,
        difficulty: room.difficulty,
        timerSeconds: room.timerMs / 1000,
      },
    });
    room.lastSessionId = session.id;

    const finalResults: Array<Record<string, unknown>> = [];
    for (const p of players) {
      const mine = answers.filter((a) => a.participantId === p.pid);
      const avgTimeMs = mine.length
        ? Math.round(mine.reduce((s, a) => s + a.timeMs, 0) / mine.length)
        : room.timerMs;
      const won = maxScore > 0 && p.score === maxScore && topCount === 1;
      finalResults.push({
        pid: p.pid,
        name: p.name,
        characterId: p.characterId,
        isAI: p.isAI,
        aiLevel: p.aiLevel,
        score: p.score,
        correctCount: p.correctCount,
        totalQuestions: room.questionCount,
        accuracy: room.questionCount ? p.correctCount / room.questionCount : 0,
        avgTimeMs,
        abilityUsed: p.abilityUsed,
        won,
      });
      await db.playerResult.create({
        data: {
          sessionId: session.id,
          participantId: p.pid,
          userId: p.uid,
          displayName: p.name,
          characterId: p.characterId,
          isAI: p.isAI,
          aiLevel: p.aiLevel,
          score: p.score,
          correctCount: p.correctCount,
          totalQuestions: room.questionCount,
          accuracy: room.questionCount ? p.correctCount / room.questionCount : 0,
          avgTimeMs,
          abilityUsed: p.abilityUsed,
          won,
        },
      });
      await db.gameParticipant
        .update({ where: { id: p.pid }, data: { score: p.score, correctCount: p.correctCount, ready: false } })
        .catch(() => undefined);
    }

    await db.gameRoom
      .update({ where: { id: room.id }, data: { status: "finished", endedAt: new Date() } })
      .catch(() => undefined);

    // Full review — the game is over, so revealing the answer key is allowed.
    const review = room.questions.map((q, i) => ({
      index: i,
      text: q.text,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      answers: players.map((p) => {
        const a = answers.find((x) => x.participantId === p.pid && x.questionIndex === i);
        return {
          pid: p.pid,
          name: p.name,
          choiceIndex: a?.choiceIndex ?? null,
          correct: a?.correct ?? false,
          points: a?.points ?? 0,
        };
      }),
    }));

    this.broadcast(room, "gameOver", {
      mode: room.mode,
      results: finalResults,
      review,
      sessionId: session.id,
    });
    this.broadcastRoomState(room);
    log(room.code, "match finished");
  }

  private async emitReconstructedGameOver(room: RuntimeRoom, socket: Socket) {
    const sessionId = room.lastSessionId;
    if (!sessionId) return;
    const session = await db.gameSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const results = await db.playerResult.findMany({ where: { sessionId } });
    const pids = results.map((r) => r.participantId);
    const answers = await db.playerAnswer.findMany({
      where: { participantId: { in: pids } },
      orderBy: { questionIndex: "asc" },
    });
    const review = room.questions.map((q, i) => ({
      index: i,
      text: q.text,
      choices: q.choices,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      answers: results.map((r) => {
        const a = answers.find((x) => x.participantId === r.participantId && x.questionIndex === i);
        return {
          pid: r.participantId,
          name: r.displayName,
          choiceIndex: a?.choiceIndex ?? null,
          correct: a?.correct ?? false,
          points: a?.points ?? 0,
        };
      }),
    }));
    socket.emit("gameOver", {
      mode: session.mode,
      results: results.map((r) => ({
        pid: r.participantId,
        name: r.displayName,
        characterId: r.characterId,
        isAI: r.isAI,
        aiLevel: r.aiLevel,
        score: r.score,
        correctCount: r.correctCount,
        totalQuestions: r.totalQuestions,
        accuracy: r.accuracy,
        avgTimeMs: r.avgTimeMs,
        abilityUsed: r.abilityUsed,
        won: r.won,
      })),
      review,
      sessionId: session.id,
    });
  }

  // ----------------------------------------------------------------- rematch

  async handleRematch(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.isHost) {
      this.emitTo(room, player.pid, "error", { message: "Only the host can start a rematch." });
      return;
    }
    if (room.phase !== "finished") {
      this.emitTo(room, player.pid, "error", { message: "Rematch is only available after a match ends." });
      return;
    }
    // Clear transient answers and reset participants for the rematch.
    await db.playerAnswer.deleteMany({
      where: { participant: { roomId: room.id } },
    }).catch(() => undefined);
    await db.gameParticipant
      .updateMany({
        where: { roomId: room.id },
        data: { score: 0, correctCount: 0, ready: false, abilityUsed: false, abilityActive: null },
      })
      .catch(() => undefined);
    await db.gameRoom.update({ where: { id: room.id }, data: { status: "lobby" } }).catch(() => undefined);

    for (const p of room.players.values()) {
      p.score = 0;
      p.correctCount = 0;
      p.ready = false;
      p.abilityUsed = false;
      p.abilityArmed = null;
      p.answered = null;
      p.eliminated = null;
      p.readyForNext = false;
    }
    room.phase = "lobby";
    room.qIndex = 0;
    room.lastSessionId = null;
    this.broadcastRoomState(room);
    log(room.code, "rematch — back to lobby");
  }

  // ----------------------------------------------------------------- ability

  handleAbility(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.phase !== "question") {
      this.emitTo(room, player.pid, "error", { message: "Abilities can only be used during a question." });
      return;
    }
    if (player.isAI) return;
    if (player.abilityUsed) {
      this.emitTo(room, player.pid, "error", { message: "Your character ability was already used this match." });
      return;
    }
    if (player.answered) {
      this.emitTo(room, player.pid, "error", { message: "Abilities must be used before answering." });
      return;
    }

    const ability = CHARACTER_ABILITY[player.characterId];
    const q = room.questions[room.qIndex];

    if (ability === "second_chance") {
      const wrong = [0, 1, 2, 3].filter((i) => i !== q.correctIndex);
      // Fisher-Yates shuffle then keep two wrong choices.
      for (let i = wrong.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
      }
      player.eliminated = wrong.slice(0, 2);
      this.emitTo(room, player.pid, "abilityEffect", {
        ability,
        eliminated: player.eliminated,
      });
    } else if (ability === "quick_reflex") {
      if (Date.now() >= player.deadline) {
        this.emitTo(room, player.pid, "error", { message: "Too late — the timer already ran out." });
        return;
      }
      player.deadline += SPRINTER_EXTRA_MS;
      this.emitTo(room, player.pid, "abilityEffect", { ability, endsAt: player.deadline, addedMs: SPRINTER_EXTRA_MS });
    } else {
      // focus_mode / double_down / lucky_break — arm a bonus.
      player.abilityArmed = ability;
      this.emitTo(room, player.pid, "abilityEffect", { ability, armed: true });
    }

    player.abilityUsed = true;
    db.gameParticipant
      .update({ where: { id: player.pid }, data: { abilityUsed: true, abilityActive: player.abilityArmed } })
      .catch(() => undefined);
    this.emitOthers(room, player.pid, "abilityUsed", { pid: player.pid, name: player.name, ability });
    this.broadcastRoomState(room);
    log(room.code, `${player.name} used ability ${ability}`);
  }

  // -------------------------------------------------------------------- exit

  /**
   * Explicit leave (user pressed "Leave"). Unlike an unexpected disconnect,
   * this resolves the room immediately:
   *  - Host leaving  → the whole room is abandoned right away (no 30s grace).
   *  - Guest leaving → their participant row is removed and others are told.
   */
  handleLeave(socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const pid = socket.data.pid as string | undefined;
    this.socketRoom.delete(socket.id);
    if (roomId) {
      const room = this.rooms.get(roomId);
      const player = pid ? room?.players.get(pid) : undefined;
      if (room && player) {
        if (room.phase === "lobby" || room.phase === "countdown") {
          if (player.isHost) {
            this.abandon(room, "The host left the lobby.");
          } else {
            room.players.delete(player.pid);
            db.gameParticipant
              .delete({ where: { id: player.pid } })
              .catch(() => undefined);
            this.broadcast(room, "playerLeft", { pid: player.pid, name: player.name });
            const humans = [...room.players.values()].filter((p) => !p.isAI);
            if (humans.length === 0) {
              this.abandon(room, "Everyone left the lobby.");
            }
          }
        } else if (room.phase === "question" || room.phase === "reveal") {
          // Leaving mid-match = abandoning for everyone.
          this.abandon(room, `${player.name} left the match.`);
        } else if (room.phase === "finished" || room.phase === "abandoned") {
          // Room over — just detach silently.
          if (player.socketId === socket.id) {
            player.socketId = null;
            player.connected = false;
          }
        }
        this.broadcastRoomState(room);
        log(room.code, `player ${player.name} left explicitly (${room.phase})`);
      }
    }
    socket.disconnect(true);
  }
}
