/**
 * STUDY CLASH — focused regression test for the LOBBY JOIN bug.
 *
 * Scenario that used to fail:
 *   1. Host creates a room and connects their socket FIRST (runtime built
 *      with a single player).
 *   2. Guest joins via HTTP AFTER that (participant row created in the DB).
 *   3. Guest connects their socket → used to get authError
 *      "You are not a participant of this match." — now they must appear in
 *      the lobby and both players must see each other.
 *
 * Also verifies:
 *   - playerJoined broadcast reaches the host.
 *   - POST /api/rooms/leave escape hatch works for the host (room abandoned).
 *   - Guest can leave cleanly.
 *
 * Run: bun scripts/join-regression.ts
 */
import { io, type Socket } from "socket.io-client";
import JSZip from "jszip";

const WEB = "http://localhost:3000";
const GAME = "http://localhost:3001";

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string, extra = "") {
  checks++;
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ FAIL: ${label} ${extra}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  cookies = new Map<string, string>();
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
  async register(username: string, password: string): Promise<boolean> {
    const res = await this.req("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return false;
    return this.login(username, password);
  }
  async login(username: string, password: string): Promise<boolean> {
    const csrfRes = await this.req("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const body = new URLSearchParams({ csrfToken, username, password, callbackUrl: "/", json: "true" });
    const res = await this.req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return this.cookies.has("next-auth.session-token") && res.status < 400;
  }
}

async function buildDocx(paragraphs: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const paras = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

interface RoomStateMsg {
  room: { code: string; mode: string };
  phase: string;
  players: Array<{ pid: string; name: string; ready: boolean; connected: boolean; isAI: boolean }>;
  you: { pid: string; isHost: boolean };
}

class TestSocket {
  roomStates: RoomStateMsg[] = [];
  playerJoined: Array<{ pid: string; name: string }> = [];
  playerLeft: Array<{ pid: string; name: string }> = [];
  authError: string | null = null;
  abandoned: string | null = null;
  constructor(public socket: Socket) {
    socket.on("roomState", (p: RoomStateMsg) => this.roomStates.push(p));
    socket.on("playerJoined", (p: { pid: string; name: string }) => this.playerJoined.push(p));
    socket.on("playerLeft", (p: { pid: string; name: string }) => this.playerLeft.push(p));
    socket.on("authError", (e: { message: string }) => (this.authError = e.message));
    socket.on("abandoned", (e: { reason: string }) => (this.abandoned = e.reason));
  }
  get state(): RoomStateMsg | null {
    return this.roomStates.length ? this.roomStates[this.roomStates.length - 1] : null;
  }
  waitFor(pred: () => boolean, ms: number, label: string): Promise<boolean> {
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        clearInterval(iv);
        console.error(`  … timeout waiting for ${label}`);
        resolve(false);
      }, ms);
      const iv = setInterval(() => {
        if (pred()) {
          clearInterval(iv);
          clearTimeout(t);
          resolve(true);
        }
      }, 100);
    });
  }
  close() {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

function connect(token: string): TestSocket {
  const socket = io(GAME, {
    path: "/",
    transports: ["websocket"],
    auth: { token },
    forceNew: true,
    reconnection: false,
    timeout: 8000,
  });
  return new TestSocket(socket);
}

async function main() {
  const stamp = Date.now().toString(36);
  const host = new Client();
  const guest = new Client();
  ok(await host.register(`jt_h_${stamp}`, "testpass123"), "host registered + logged in");
  ok(await guest.register(`jt_g_${stamp}`, "testpass123"), "guest registered + logged in");

  // Upload + generate quiz (host owns the material).
  const docBlob = await buildDocx([
    "Photosynthesis converts light energy into chemical energy stored in glucose.",
    "Chlorophyll absorbs red and blue light most strongly and reflects green light.",
    "The light-dependent reactions occur in the thylakoid membranes of chloroplasts.",
    "The Calvin cycle fixes carbon dioxide into three-carbon sugars in the stroma.",
    "Mitochondria produce ATP through oxidative phosphorylation.",
    "DNA replication is semiconservative: each strand templates a new strand.",
    "Enzymes lower activation energy and are not consumed by reactions.",
    "Osmosis is the diffusion of water across a semipermeable membrane.",
    "Neurons transmit signals via action potentials along axons.",
    "Homeostasis maintains stable internal conditions via feedback loops.",
    "Cell respiration glycolysis happens in the cytoplasm and yields pyruvate.",
    "The nucleus stores genetic information chromatin.",
  ]);
  const form = new FormData();
  form.append("file", docBlob, "join-test.docx");
  const upRes = await host.req("/api/documents", { method: "POST", body: form });
  const up = (await upRes.json()) as { document?: { id: string } };
  ok(!!up.document, "document uploaded");
  const docId = up.document!.id;

  // Generate a 10-question EASY quiz (synchronous AI call).
  const genRes = await host.req(`/api/documents/${docId}/generate`, {
    method: "POST",
    body: JSON.stringify({ count: 10, difficulty: "EASY" }),
  });
  const genData = (await genRes.json()) as { quiz?: { id: string; status: string } };
  ok(
    genRes.status === 200 && genData.quiz?.status === "ready",
    "quiz generated & ready"
  );
  const quizId = genData.quiz?.id ?? null;
  if (!quizId) {
    console.error("Cannot continue without a quiz.", JSON.stringify(genData).slice(0, 300));
    process.exit(1);
  }

  // --- THE REGRESSION SCENARIO ---
  // 1. Host creates room via HTTP and connects socket FIRST.
  const createRes = await host.req("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ quizId, timerSeconds: 10, characterId: "thinker" }),
  });
  const created = (await createRes.json()) as { room: { code: string }; token: string };
  ok(createRes.status === 200 && !!created.token, `room created (${created.room?.code})`);

  const hostSock = connect(created.token);
  ok(
    await hostSock.waitFor(() => hostSock.state !== null, 8000, "host roomState"),
    "host socket attached and got roomState"
  );
  ok(hostSock.state?.players.length === 1, "host sees exactly 1 player (self)");

  // 2. Guest joins via HTTP AFTER the runtime was built (the old failure point).
  const joinRes = await guest.req("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code: created.room.code }),
  });
  const joined = (await joinRes.json()) as { room?: unknown; token?: string; error?: string };
  ok(joinRes.status === 200 && !!joined.token, `guest HTTP join ok (${joined.error ?? ""})`);

  // 3. Guest connects their socket — previously authError, now must work.
  const guestSock = connect(joined.token!);
  ok(
    await guestSock.waitFor(() => guestSock.state !== null, 8000, "guest roomState"),
    "guest socket attached — NO authError (join bug fixed)"
  );
  ok(guestSock.authError === null, `guest received no authError (got: ${guestSock.authError})`);
  ok(guestSock.state?.players.length === 2, "guest sees 2 players in lobby");
  ok(
    await hostSock.waitFor(() => (hostSock.state?.players.length ?? 0) === 2, 8000, "host sees guest"),
    "host now sees the guest in roomState"
  );
  ok(
    hostSock.playerJoined.some((p) => p.name === guestSock.state?.players.find((p) => !p.isHost)?.name),
    "host received playerJoined broadcast"
  );

  // 4. Guest readies up; host sees it.
  guestSock.socket.emit("ready", { value: true });
  ok(
    await hostSock.waitFor(
      () => hostSock.state?.players.find((p) => !p.isHost)?.ready === true,
      8000,
      "guest ready flag"
    ),
    "host sees guest ready state live"
  );

  // 5. Guest leaves cleanly via socket 'leave' — participant removed.
  guestSock.socket.emit("leave");
  ok(
    await hostSock.waitFor(() => (hostSock.state?.players.length ?? 2) === 1, 8000, "guest removed"),
    "guest leave → host sees 1 player again"
  );
  guestSock.close();

  // 6. Host leaves via the HTTP escape hatch → room abandoned in DB.
  const leaveRes = await host.req("/api/rooms/leave", { method: "POST" });
  const leaveBody = (await leaveRes.json()) as { left: boolean; abandoned?: boolean };
  ok(leaveRes.status === 200 && leaveBody.left === true, "POST /api/rooms/leave works");
  ok(leaveBody.abandoned === true, "host leave → room abandoned");
  ok(
    await hostSock.waitFor(() => hostSock.abandoned !== null, 8000, "abandoned event"),
    "host socket received 'abandoned' event"
  );
  hostSock.close();

  // 7. Host is unblocked: can create a NEW room immediately.
  const create2 = await host.req("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ quizId, timerSeconds: 15, characterId: "sprinter" }),
  });
  ok(create2.status === 200, "host can create a fresh room right after leaving");
  const created2 = (await create2.json()) as { room: { code: string }; token: string };

  // 8. Guest can also join the fresh room (not stuck).
  const join2 = await guest.req("/api/rooms/join", {
    method: "POST",
    body: JSON.stringify({ code: created2.room.code }),
  });
  ok(join2.status === 200, "guest can join the fresh room (not blocked)");

  // Cleanup: leave the second room so both users are unblocked.
  await host.req("/api/rooms/leave", { method: "POST" });
  await guest.req("/api/rooms/leave", { method: "POST" });

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
