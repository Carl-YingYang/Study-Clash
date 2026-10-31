// Minimal debug: connect one socket, log every event received.
import { io } from "socket.io-client";

const WEB = "http://localhost:3000";
const GAME = "http://localhost:3001";

const cookies = new Map<string, string>();
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(WEB + path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  for (const sc of (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return res;
}

const stamp = Date.now().toString(36).slice(-6);
const user = process.argv[2] ?? `dbg_${stamp}`;
const isExisting = !!process.argv[2];
if (!isExisting) {
  await req("/api/auth/register", { method: "POST", body: JSON.stringify({ username: user, password: "study123" }) });
}
const { csrfToken } = await (await req("/api/auth/csrf")).json();
await req("/api/auth/callback/credentials", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken, username: user, password: "study123", callbackUrl: "/", json: "true" }).toString(),
});

// list documents, find a ready quiz
const docs = await (await req("/api/documents")).json();
const quiz = docs.documents?.flatMap((d: { quizzes: unknown[] }) => d.quizzes)?.find((q: { status: string }) => q.status === "ready");
if (!quiz) {
  console.log("no ready quiz found — aborting");
  process.exit(1);
}
console.log("using quiz", quiz.id);

const pr = await req("/api/game/practice", {
  method: "POST",
  body: JSON.stringify({ quizId: quiz.id, timerSeconds: 10, aiLevel: "MID", characterId: "thinker" }),
});
const prData = await pr.json();
console.log("practice room:", JSON.stringify(prData).slice(0, 200));
if (!prData.token) process.exit(1);

const socket = io(GAME, {
  path: "/",
  transports: ["websocket"],
  auth: { token: prData.token },
  forceNew: true,
  reconnection: false,
  timeout: 8000,
});

socket.onAny((event, ...args) => {
  console.log(`EVENT ${event}:`, JSON.stringify(args).slice(0, 220));
});

socket.on("connect", () => console.log("connected", socket.id));
socket.on("disconnect", (r) => console.log("disconnected:", r));
socket.on("connect_error", (e) => console.log("connect_error:", e.message));

setTimeout(() => {
  console.log("emitting ready + start");
  socket.emit("ready", { value: true });
  setTimeout(() => socket.emit("start"), 300);
}, 800);

setTimeout(() => {
  console.log("done");
  socket.disconnect();
  process.exit(0);
}, 25000);
