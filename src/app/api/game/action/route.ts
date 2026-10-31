
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  runGameAction,
  GameActionError,
  type GameAction,
} from "@/lib/game-engine";

export const runtime = "nodejs";

const ALLOWED_ACTIONS: GameAction[] = [
  "sync",
  "tick",
  "ready",
  "character",
  "start",
  "answer",
  "ability",
  "next",
  "rematch",
  "leave",
];

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);

    const roomId =
      typeof body?.roomId === "string" ? body.roomId.trim() : "";

    const action =
      typeof body?.action === "string" ? body.action : "";

    if (!roomId || roomId.length > 128) {
      return NextResponse.json(
        { error: "A valid room ID is required." },
        { status: 400 }
      );
    }

    if (!ALLOWED_ACTIONS.includes(action as GameAction)) {
      return NextResponse.json(
        { error: "Invalid game action." },
        { status: 400 }
      );
    }

    const data =
      body?.data &&
      typeof body.data === "object" &&
      !Array.isArray(body.data)
        ? body.data as Record<string, unknown>
        : {};

    const snapshot = await runGameAction(
      roomId,
      user.id,
      action as GameAction,
      data
    );

    return NextResponse.json(
      {
        ok: true,
        snapshot,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if (error instanceof GameActionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[Game Action API]", error);

    return NextResponse.json(
      { error: "The game action could not be completed." },
      { status: 500 }
    );
  }
}
