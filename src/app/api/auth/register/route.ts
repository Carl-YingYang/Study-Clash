import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const username =
      typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3-20 characters: lowercase letters, numbers or underscore.",
        },
        { status: 400 }
      );
    }
    if (password.length < 6 || password.length > 100) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 }
      );
    }

    const user = await db.user.create({
      data: { username, passwordHash: hashPassword(password) },
    });

    return NextResponse.json({ id: user.id, username: user.username });
  } catch (err) {
    console.error("register error", err);
    return NextResponse.json({ error: "Registration failed. Try again." }, { status: 500 });
  }
}
