// STUDY CLASH — game service entry (socket.io on port 3001)
// The path MUST stay "/" — the sandbox gateway (Caddy) forwards requests
// carrying ?XTransformPort=3001 to this service.
//
// NOTE: engine.io with path "/" intercepts every HTTP request on the main
// port, so the internal control endpoint runs on its own port (3002).
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { GameEngine } from "./src/engine";
import { db } from "./src/db";

const GAME_SECRET = process.env.GAME_SECRET ?? "";

const httpServer = createServer((req, res) => {
  // socket.io (path "/") handles everything on this port; this fallback is
  // only reachable for non-matching cases in exotic setups.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ service: "study-clash-game", status: "ok" }));
});

const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

const engine = new GameEngine(io);

// ---------------------------------------------------------------------------
// Internal control endpoint (port 3002, localhost only in practice).
// Lets the Next.js API force-abandon a room (escape hatch) so connected
// sockets are notified immediately. Authenticated with the shared GAME_SECRET.
// ---------------------------------------------------------------------------
const controlServer = createServer((req, res) => {
  if (req.url === "/internal/abandon" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e4) req.destroy();
    });
    req.on("end", () => {
      if (req.headers["x-game-secret"] !== GAME_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const { roomId, reason } = JSON.parse(body) as { roomId?: string; reason?: string };
        if (typeof roomId !== "string") throw new Error("roomId required");
        engine.forceAbandon(roomId, reason ?? "The match was closed.");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const PORT = 3001;
const CONTROL_PORT = 3002;

httpServer.listen(PORT, () => {
  console.log(`Study Clash game service running on port ${PORT}`);
});

controlServer.listen(CONTROL_PORT, "127.0.0.1", () => {
  console.log(`Study Clash control endpoint on port ${CONTROL_PORT}`);
});

io.on("connection", (socket: Socket) => {
  socket.onAny((event) => {
    if (!["room:sync", "character", "ready", "start", "answer", "ability", "next", "rematch", "leave"].includes(event)) {
      socket.emit("error", { message: `Unknown event: ${event}` });
    }
  });

  void engine.attachSocket(socket);

  socket.on("room:sync", () => engine.handleSync(socket));
  socket.on("character", (data) => engine.handleCharacter(socket, data));
  socket.on("ready", (data) => engine.handleReady(socket, data));
  socket.on("start", () => void engine.handleStart(socket));
  socket.on("answer", (data) => engine.handleSubmit(socket, data));
  socket.on("ability", () => engine.handleAbility(socket));
  socket.on("next", () => engine.handleNext(socket));
  socket.on("rematch", () => void engine.handleRematch(socket));
  socket.on("leave", () => engine.handleLeave(socket));
  socket.on("disconnect", () => engine.detachSocket(socket));
  socket.on("error", (err) => console.error(`socket error (${socket.id}):`, err?.message ?? err));
});

async function shutdown() {
  console.log("Shutting down game service...");
  io.close();
  controlServer.close();
  await db.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
