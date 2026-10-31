
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { createSupabaseRealtimeToken } from "@/lib/supabase/realtime-token";

export const runtime = "nodejs";

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

    if (!roomId || roomId.length > 128) {
      return NextResponse.json(
        { error: "A valid room ID is required." },
        { status: 400 }
      );
    }

    const participant = await db.gameParticipant.findFirst({
      where: {
        roomId,
        userId: user.id,
        room: {
          status: {
            in: ["lobby", "playing", "finished"],
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "You are not authorized to access this room." },
        { status: 403 }
      );
    }

    const accessToken = await createSupabaseRealtimeToken(
      user.id,
      roomId
    );

    return NextResponse.json(
      {
        accessToken,
        expiresIn: 300,
        topic: `sc:room:${roomId}`,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[Realtime Token API]", error);

    return NextResponse.json(
      { error: "Unable to create Realtime access token." },
      { status: 500 }
    );
  }
}
