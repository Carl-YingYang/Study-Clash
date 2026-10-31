// STUDY CLASH — authentication (NextAuth v4, credentials provider, JWT sessions)
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    CredentialsProvider({
      name: "Study Clash Account",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim().toLowerCase();
        const password = credentials?.password;
        if (!username || !password) return null;
        const user = await db.user.findUnique({ where: { username } });
        if (!user) return null;
        if (!verifyPassword(password, user.passwordHash)) return null;
        return {
          id: user.id,
          name: user.username,
          characterId: user.characterId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.username = user.name;
        token.characterId = (user as { characterId?: string }).characterId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.uid as string | undefined;
        session.user.name = (token.username as string | undefined) ?? session.user.name;
        (session.user as { characterId?: string }).characterId =
          token.characterId as string | undefined;
      }
      return session;
    },
  },
};
