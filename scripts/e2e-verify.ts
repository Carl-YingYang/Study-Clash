/**
 * STUDY CLASH — end-to-end verification script (dev tool).
 *
 * Verifies against the REAL running services (Next.js :3000, game service :3001):
 *   1. Register/login two users via the real NextAuth flow (cookies).
 *   2. Build a real DOCX, upload it, extract text.
 *   3. Generate a 10-question EASY quiz via the real AI (z-ai-web-dev-sdk).
 *   4. Full CLASH match with two socket.io clients:
 *      - identical questions/choices to both players
 *      - answer key NEVER present in pre-lock payloads
 *      - server-side scoring + round reveal after lock
 *      - THINKER ability (50/50) works once
 *      - duplicate submissions rejected
 *   5. Practice match vs EASY bot and vs GENIUS bot (distinct behavior).
 *   6. Leaderboard API contains both completed records, separated by mode.
 *   7. Bad tokens / bad room codes rejected.
 *
 * Run: bun scripts/e2e-verify.ts
 */
import { io, type Socket } from "socket.io-client";
import JSZip from "jszip";

const WEB = "http://localhost:3000";
const GAME = "http://localhost:3001";

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, extra = "") {
  checks++;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${label} ${extra}`);
  }
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------- cookie jar
class Client {
  cookies = new Map<string, string>();
  username = "";

  async req(path: string, init: RequestInit = {}): Promise<Response> {
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(WEB + path, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
      redirect: "manual",
    });
    const setCookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  }

  async login(username: string, password: string): Promise<boolean> {
    this.username = username;
    const csrfRes = await this.req("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const body = new URLSearchParams({
      csrfToken,
      username,
      password,
      callbackUrl: "/",
      json: "true",
    });
    const res = await this.req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return this.cookies.has("next-auth.session-token") && res.status < 400;
  }
}

// ------------------------------------------------------------------ docx build
async function buildDocx(paragraphs: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const paras = paragraphs
    .map(
      (p) =>
        `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paras}</w:body></w:document>`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// --------------------------------------------------------------- socket helper
interface QuestionMsg {
  index: number;
  total: number;
  text: string;
  choices: string[];
  difficulty: string;
  timerMs: number;
  endsAt: number;
  serverTime: number;
  youAnswered: number | null;
  eliminated?: number[] | null;
}

interface RoundResultMsg {
  index: number;
  text: string;
  choices: string[];
  correctIndex: number;
  results: Array<{ pid: string; name: string; choiceIndex: number | null; correct: boolean; points: number }>;
  scores: Array<{ pid: string; score: number }>;
}

class PlayerSocket {
  socket: Socket;
  questions: QuestionMsg[] = [];
  rounds: RoundResultMsg[] = [];
  eliminated: number[] = [];
  rejected = 0;
  gameOver: {
    results: Array<{ pid: string; name: string; score: number; correctCount: number; won: boolean; isAI: boolean }>;
    review: Array<{ index: number; correctIndex: number; choices: string[] }>;
  } | null = null;
  authError: string | null = null;

  constructor(token: string) {
    this.socket = io(GAME, {
      path: "/",
      transports: ["websocket"],
      auth: { token },
      forceNew: true,
      reconnection: false,
      timeout: 8000,
    });
    this.socket.on("question", (q: QuestionMsg & { eliminated?: number[] | null }) => {
      this.questions.push(q);
      if (q.eliminated && q.eliminated.length) this.eliminated = q.eliminated;
    });
    this.socket.on("abilityEffect", (e: { ability: string; eliminated?: number[] }) => {
      if (e.eliminated && e.eliminated.length) this.eliminated = e.eliminated;
    });
    this.socket.on("roundResult", (r: RoundResultMsg) => {
      this.rounds.push(r);
    });
    this.socket.on("gameOver", (g: NonNullable<PlayerSocket["gameOver"]>) => {
      this.gameOver = g;
    });
    this.socket.on("answerRejected", () => {
      this.rejected++;
    });
    this.socket.on("authError", (e: { message: string }) => {
      this.authError = e.message;
    });
  }

  waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<boolean> {
    if (predicate()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        clearInterval(interval);
        console.error(`  … timeout waiting for ${label}`);
        resolve(false);
      }, timeoutMs);
      const interval = setInterval(() => {
        if (predicate()) done();
      }, 150);
    });
  }

  async close() {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ===========================================================================
async function main() {
  const host = new Client();
  const guest = new Client();
  const stamp = Date.now().toString(36).slice(-6);

  section("1) Registration & login (NextAuth credentials)");
  for (const [name, c, user] of [
    ["host", host, `e2eh_${stamp}`],
    ["guest", guest, `e2eg_${stamp}`],
  ] as const) {
    const reg = await c.req("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: user, password: "study123" }),
    });
    ok(reg.status === 200, `${name} registered (${user})`);
    const loggedIn = await c.login(user, "study123");
    ok(loggedIn, `${name} logged in via NextAuth`);
  }
  const sessionCheck = await host.req("/api/auth/session");
  const session = await sessionCheck.json();
  ok(session?.user?.name === `e2eh_${stamp}`, "session carries the username");

  section("2) DOCX upload & extraction");
  const docxBlob = await buildDocx([
    "Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose.",
    "The reaction takes place in the chloroplasts, specifically in the thylakoid membranes where chlorophyll absorbs light.",
    "The light-dependent reactions split water molecules, releasing oxygen as a by-product and producing ATP and NADPH.",
    "The Calvin cycle, which occurs in the stroma, uses ATP and NADPH to fix carbon dioxide into three-carbon sugars.",
    "Chlorophyll absorbs mostly red and blue wavelengths of light and reflects green light, which is why leaves appear green.",
    "Stomata are tiny pores on leaf surfaces that regulate gas exchange, letting carbon dioxide in and oxygen out.",
    "The overall equation for photosynthesis is six carbon dioxide plus six water, with light energy, producing glucose and six oxygen.",
    "Photosynthesis occurs in two stages: the light-dependent reactions and the light-independent Calvin cycle.",
    "Plants that use C4 photosynthesis, such as maize, concentrate carbon dioxide around RuBisCO to reduce water loss in hot climates.",
    "The rate of photosynthesis depends on light intensity, carbon dioxide concentration, and temperature.",
    "Respiration breaks down glucose to release energy, which is essentially the reverse process of photosynthesis.",
    "Photosynthetic pigments include chlorophyll a, chlorophyll b, and carotenoids, each absorbing different wavelengths.",
  ]);
  const form = new FormData();
  form.append("file", docxBlob, "photosynthesis-notes.docx");
  const upRes = await host.req("/api/documents", { method: "POST", body: form });
  const upData = await upRes.json();
  ok(upRes.status === 200 && upData.document?.status === "ready", "DOCX uploaded and extracted", JSON.stringify(upData).slice(0, 200));
  ok((upData.document?.textChars ?? 0) > 600, `extracted ${upData.document?.textChars} chars`);
  const docId = upData.document.id as string;

  const badType = new FormData();
  badType.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  const badRes = await host.req("/api/documents", { method: "POST", body: badType });
  ok(badRes.status === 415, "TXT upload rejected with 415");

  section("3) AI quiz generation (10 EASY questions)");
  console.log("  … calling the LLM, this can take a while");
  const genRes = await host.req(`/api/documents/${docId}/generate`, {
    method: "POST",
    body: JSON.stringify({ count: 10, difficulty: "EASY" }),
  });
  const genData = await genRes.json();
  ok(genRes.status === 200 && genData.quiz?.status === "ready", "quiz generated & ready", JSON.stringify(genData).slice(0, 300));
  const quizId = genData.quiz?.id as string;
  ok(!!quizId, "quiz id returned");

  section("4) Room creation & joining");
  const roomRes = await host.req("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ quizId, timerSeconds: 10, characterId: "thinker" }),
  });
  const roomData = await roomRes.json();
  ok(roomRes.status === 200 && !!roomData.token, "host created room");
  const roomCode = roomData.room.code as string;
  console.log(`  … room code: ${roomCode}`);

  const badJoin = await guest.req("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code: "ZZZZZZ" }),
  });
  ok(badJoin.status === 404, "unknown room code → 404");

  const joinRes = await guest.req("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code: roomCode }),
  });
  const joinData = await joinRes.json();
  ok(joinRes.status === 200 && !!joinData.token, "guest joined with code");
  ok(joinData.room?.questionCount === 10 && joinData.room?.difficulty === "EASY", "room carries quiz settings");

  const third = new Client();
  await third.req("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: `e2ex_${stamp}`, password: "study123" }),
  });
  await third.login(`e2ex_${stamp}`, "study123");
  const fullJoin = await third.req("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code: roomCode }),
  });
  ok(fullJoin.status === 409, "third player blocked from full room");

  section("5) Full CLASH match — privacy + sync + scoring");
  const hs = new PlayerSocket(roomData.token);
  const gs = new PlayerSocket(joinData.token);
  await sleep(700);
  ok(hs.socket.connected && gs.socket.connected, "both sockets connected");
  ok(!hs.authError && !gs.authError, "no auth errors");

  // Bad token socket must be rejected.
  const badSock = io(GAME, { path: "/", transports: ["websocket"], auth: { token: "garbage.token" }, timeout: 5000 });
  const badAuth = await new Promise<string | null>((resolve) => {
    badSock.on("authError", (e: { message: string }) => resolve(e.message));
    setTimeout(() => resolve(null), 4000);
  });
  ok(badAuth !== null, "forged token rejected by game service");
  badSock.disconnect();

  hs.socket.emit("ready", { value: true });
  gs.socket.emit("ready", { value: true });
  await sleep(400);
  hs.socket.emit("start");

  let privacyClean = true;
  let identicalChoices = true;

  for (let qi = 0; qi < 10; qi++) {
    const gotH = await hs.waitFor(() => hs.questions.some((q) => q.index === qi), 15000, `host q${qi}`);
    const gotG = await gs.waitFor(() => gs.questions.some((q) => q.index === qi), 15000, `guest q${qi}`);
    if (!gotH || !gotG) {
      ok(false, `question ${qi} delivered to both players`);
      break;
    }
    const qh = hs.questions.find((q) => q.index === qi)!;
    const qg = gs.questions.find((q) => q.index === qi)!;
    if (qi === 0) ok(true, "first question delivered to both players");
    if (qh.text !== qg.text || JSON.stringify(qh.choices) !== JSON.stringify(qg.choices)) {
      identicalChoices = false;
    }
    // THE critical privacy assertions:
    for (const q of [qh, qg]) {
      if ("correctIndex" in (q as Record<string, unknown>)) privacyClean = false;
      if ("explanation" in (q as Record<string, unknown>)) privacyClean = false;
    }

    // Host uses THINKER ability on question 0.
    if (qi === 0) {
      hs.socket.emit("ability");
      await hs.waitFor(() => hs.eliminated.length === 2, 5000, "thinker 50/50 effect");
      ok(
        hs.eliminated.length === 2 && new Set(hs.eliminated).size === 2 && hs.eliminated.every((i) => i >= 0 && i <= 3),
        "THINKER removed exactly two distinct choices"
      );
    }

    // Answers: host fast-ish, guest a bit later; guest double-submits on q1.
    hs.socket.emit("answer", { index: qi, choiceIndex: qi % 4 });
    await sleep(250);
    gs.socket.emit("answer", { index: qi, choiceIndex: (qi + 1) % 4 });
    if (qi === 1) {
      gs.socket.emit("answer", { index: qi, choiceIndex: (qi + 2) % 4 }); // duplicate
      gs.socket.emit("answer", { index: qi, choiceIndex: (qi + 3) % 4 }); // duplicate
    }

    const locked = await hs.waitFor(() => hs.rounds.some((r) => r.index === qi), 16000, `round ${qi} lock`);
    await gs.waitFor(() => gs.rounds.some((r) => r.index === qi), 16000, `guest round ${qi}`);
    if (!locked) break;
    const rr = hs.rounds.find((r) => r.index === qi)!;
    if (qi === 0) {
      ok(typeof rr.correctIndex === "number" && rr.correctIndex >= 0 && rr.correctIndex <= 3, "correct answer revealed only AFTER lock");
      ok(rr.results.length === 2 && rr.results.every((r) => typeof r.points === "number"), "server scored both players");
    }
    // advance immediately
    hs.socket.emit("next");
    gs.socket.emit("next");
  }

  ok(privacyClean, "NO answer key in any pre-lock 'question' payload (both players, 10 rounds)");
  ok(identicalChoices, "both players received identical question text & choices every round");
  ok(gs.rejected >= 2, "duplicate submissions rejected");

  await hs.waitFor(() => hs.gameOver !== null, 20000, "gameOver");
  await gs.waitFor(() => gs.gameOver !== null, 20000, "guest gameOver");
  ok(!!hs.gameOver && !!gs.gameOver, "gameOver delivered to both");
  if (hs.gameOver) {
    const go = hs.gameOver;
    ok(go.review.length === 10, "review contains all 10 questions with answer keys (game ended)");
    ok(go.results.length === 2, "final results for both players");
    const hostRes = go.results.find((r) => r.name.startsWith("e2eh_"))!;
    const guestRes = go.results.find((r) => r.name.startsWith("e2eg_"))!;
    console.log(`  … final score: host ${hostRes.score} (${hostRes.correctCount}/10) vs guest ${guestRes.score} (${guestRes.correctCount}/10)`);
    const sumRounds = hs.rounds.reduce((s, r) => s + (r.results.find((x) => x.name.startsWith("e2eh_"))?.points ?? 0), 0);
    ok(Math.abs(hostRes.score - sumRounds) < 1, "host final score equals sum of server round points");
  }
  await hs.close();
  await gs.close();

  section("6) Practice mode — EASY bot vs GENIUS bot");
  async function practiceMatch(level: string) {
    const pr = await host.req("/api/game/practice", {
      method: "POST",
      body: JSON.stringify({ quizId, timerSeconds: 10, aiLevel: level, characterId: "trickster" }),
    });
    const prData = await pr.json();
    ok(pr.status === 200 && !!prData.token, `practice room created (${level})`);
    const ps = new PlayerSocket(prData.token);
    await sleep(600);
    ok(ps.socket.connected, `${level} practice socket connected`);
    ps.socket.emit("ready", { value: true });
    await sleep(300);
    ps.socket.emit("start");
    let privacyCleanPractice = true;
    for (let qi = 0; qi < 10; qi++) {
      await ps.waitFor(() => ps.questions.some((q) => q.index === qi), 15000, `practice q${qi}`);
      const q = ps.questions.find((x) => x.index === qi)!;
      if ("correctIndex" in (q as Record<string, unknown>)) privacyCleanPractice = false;
      // TRICKSTER ability on question 2 (double down armed).
      if (qi === 2) ps.socket.emit("ability");
      ps.socket.emit("answer", { index: qi, choiceIndex: qi % 4 });
      await ps.waitFor(() => ps.rounds.some((r) => r.index === qi), 16000, `practice round ${qi}`);
      ps.socket.emit("next");
    }
    ok(privacyCleanPractice, `${level}: no answer key leaked in practice question payloads`);
    await ps.waitFor(() => ps.gameOver !== null, 20000, "practice gameOver");
    const botFinal = ps.gameOver?.results.find((r) => r.isAI);
    const humanFinal = ps.gameOver?.results.find((r) => !r.isAI);
    ok(!!botFinal && !!humanFinal, `${level}: bot and human both in final results`);
    console.log(`  … ${level}: human ${humanFinal?.correctCount}/10 (${humanFinal?.score} pts), bot ${botFinal?.correctCount}/10 (${botFinal?.score} pts)`);
    await ps.close();
    return { botCorrect: botFinal?.correctCount ?? 0, humanCorrect: humanFinal?.correctCount ?? 0 };
  }

  const easyBot = await practiceMatch("EASY");
  const geniusBot = await practiceMatch("GENIUS");
  ok(geniusBot.botCorrect > easyBot.botCorrect, `GENIUS bot (${geniusBot.botCorrect}/10) outperformed EASY bot (${easyBot.botCorrect}/10)`);

  section("7) Leaderboards & separation");
  const lb = await host.req(`/api/leaderboard?division=10&difficulty=EASY&mode=clash`);
  const lbData = await lb.json();
  const lbNames = (lbData.entries ?? []).map((e: { username: string }) => e.username);
  ok(lbNames.includes(`e2eh_${stamp}`) && lbNames.includes(`e2eg_${stamp}`), "both clash players appear in 10-item EASY division");
  ok(!(lbData.entries ?? []).some((e: { username: string }) => e.username.includes("Bot")), "AI opponents never appear in rankings");

  const lb20 = await host.req(`/api/leaderboard?division=20&difficulty=EASY&mode=clash`);
  const lb20Data = await lb20.json();
  ok((lb20Data.entries ?? []).length === 0, "10-item records do NOT appear in the 20-item division");

  const lbp = await host.req(`/api/leaderboard?division=10&difficulty=EASY&mode=practice`);
  const lbpData = await lbp.json();
  const practiceNames = (lbpData.entries ?? []).map((e: { username: string }) => e.username);
  ok(practiceNames.includes(`e2eh_${stamp}`), "practice records appear in the practice rankings");
  ok(!practiceNames.includes(`e2eg_${stamp}`), "clash-only players do NOT appear in practice rankings");

  const profile = await host.req("/api/profile");
  const profileData = await profile.json();
  ok(profileData.profile?.totalGames === 3, `profile counted 3 completed games (got ${profileData.profile?.totalGames})`);
  ok(profileData.profile?.practiceGames === 2 && profileData.profile?.clashGames === 1, "mode split correct in profile");

  section("8) Cross-user document privacy");
  const foreignDoc = await guest.req(`/api/documents/${docId}`);
  ok(foreignDoc.status === 404, "other users' documents are not accessible");

  console.log(`\n============================`);
  console.log(`${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E script crashed:", err);
  process.exit(1);
});
