"use client";

import { useRouterStore } from "../stores";
import { useGameStore } from "../stores";
import { useActiveRoom, useProfile } from "../hooks";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CharacterChip } from "../parts/character-chip";
import {
  Swords,
  Bot,
  FolderOpen,
  Trophy,
  Loader2,
  ArrowUpRight,
  Zap,
  Target,
  FileStack,
  ShieldAlert,
  DoorOpen,
} from "lucide-react";
import { sounds } from "@/lib/sounds";
import { formatAccuracy } from "../api";
import type { ProfileStats } from "@/lib/types";

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Zap;
  accent: string;
}) {
  return (
    <div className="nb-card p-4 flex items-center gap-3">
      <span className={`${accent} border-2 border-ink rounded-lg p-2 shrink-0`}>
        <Icon className="size-5 text-ink" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-display font-bold text-xl leading-tight truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground font-medium truncate">{sub}</p>}
      </div>
    </div>
  );
}

function RecentGameRow({ game }: { game: ProfileStats["recentGames"][number] }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b-2 border-dashed border-ink/15 last:border-0">
      <span
        className={`nb-chip ${game.won ? "bg-mint" : "bg-coral"} text-ink`}
      >
        {game.won ? "Won" : "Lost"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate">
          {game.mode === "CLASH" ? "Clash" : "Practice"} vs {game.opponentName} ·{" "}
          <span className="text-muted-foreground">
            {game.questionCount} items · {game.difficulty}
          </span>
        </p>
        <p className="text-xs text-muted-foreground font-medium">
          {game.score} pts · {formatAccuracy(game.accuracy)} accuracy
        </p>
      </div>
      <CharacterChip characterId={game.characterId} showName={false} />
    </div>
  );
}

export default function DashboardView() {
  const go = useRouterStore((s) => s.go);
  const connectGame = useGameStore((s) => s.connect);
  const disconnectGame = useGameStore((s) => s.disconnect);
  const { profile, loading } = useProfile();
  const { room: activeRoom, refresh: refreshActiveRoom } = useActiveRoom();
  const { toast } = useToast();

  async function handleLeaveMatch() {
    try {
      const data = await api<{ left: boolean; message: string }>("/api/rooms/leave", {
        method: "POST",
      });
      sounds.play("leave");
      disconnectGame();
      toast({ title: data.left ? "Left the match" : "Nothing to leave", description: data.message });
      void refreshActiveRoom();
    } catch (err) {
      toast({
        title: "Could not leave",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">
            {profile ? `Hey, ${profile.username}` : "Dashboard"}
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            {profile && profile.totalGames > 0
              ? `${profile.totalGames} completed match${profile.totalGames === 1 ? "" : "es"} — keep the streak alive.`
              : "Upload a document, generate a quiz and start clashing."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="lg" onClick={() => go("clash")}>
            <Swords className="size-4" /> New Clash
          </Button>
          <Button size="lg" variant="secondary" onClick={() => go("practice")}>
            <Bot className="size-4" /> Practice vs AI
          </Button>
        </div>
      </div>

      {/* Active match / rejoin */}
      {activeRoom && (
        <div className="nb-card p-5 bg-lav flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-ink text-paper border-2 border-ink rounded-lg p-2.5 shrink-0">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <p className="font-display font-bold text-lg uppercase tracking-wide">
                Match in progress
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                Room <span className="font-display tracking-widest font-bold">{activeRoom.room.code}</span>{" "}
                · {activeRoom.room.mode === "CLASH" ? "Clash" : "Practice"} ·{" "}
                {activeRoom.room.status === "lobby" ? "waiting in lobby" : "game running"}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="lg"
              onClick={() => {
                connectGame(activeRoom.token);
                go(activeRoom.room.status === "lobby" ? "lobby" : "game");
              }}
            >
              Rejoin match <ArrowUpRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => void handleLeaveMatch()}
              title="Leave this match so you can start or join another"
            >
              <DoorOpen className="size-4" /> Leave match
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="nb-card p-4 h-[76px] animate-pulse bg-muted" />
          ))}
        </div>
      )}
      {profile && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Clash wins"
            value={`${profile.clashWins}/${profile.clashGames}`}
            sub="multiplayer record"
            icon={Swords}
            accent="bg-coral"
          />
          <StatTile
            label="Overall accuracy"
            value={formatAccuracy(profile.overallAccuracy)}
            sub={`${profile.totalGames} games`}
            icon={Target}
            accent="bg-mint"
          />
          <StatTile
            label="Best score"
            value={`${profile.bestScore}`}
            sub="points in one match"
            icon={Zap}
            accent="bg-lav"
          />
          <StatTile
            label="Quizzes ready"
            value={`${profile.quizzes}`}
            sub={`${profile.documents} documents`}
            icon={FileStack}
            accent="bg-card"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5 items-start">
        {/* Recent games */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display uppercase tracking-wide">Recent matches</CardTitle>
            <CardDescription className="font-medium">
              Your last completed games — full history on your profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" /> Loading matches…
              </div>
            ) : profile && profile.recentGames.length > 0 ? (
              <div className="max-h-96 overflow-y-auto scrollbar-nb pr-1">
                {profile.recentGames.map((g) => (
                  <RecentGameRow key={g.id} game={g} />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-bold text-muted-foreground">No matches yet.</p>
                <p className="text-sm text-muted-foreground font-medium mt-1">
                  Generate a quiz from your material and jump in.
                </p>
                <Button className="mt-4" onClick={() => go("library")}>
                  <FolderOpen className="size-4" /> Open library
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick start + favorite character */}
        <div className="flex flex-col gap-5">
          {profile && profile.favoriteCharacter && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display uppercase tracking-wide">Main character</CardTitle>
                <CardDescription className="font-medium">Your most played identity</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <CharacterChip characterId={profile.favoriteCharacter} showName={false} className="scale-125 origin-left" />
                <div>
                  <p className="font-display font-bold uppercase">
                    {profile.favoriteCharacter.replace(/_/g, " ")}
                  </p>
                  <p className="text-sm text-muted-foreground font-medium">
                    Switch anytime in settings or before a match.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="bg-ink text-paper border-ink">
            <CardHeader>
              <CardTitle className="font-display uppercase tracking-wide flex items-center gap-2">
                <Trophy className="size-4 text-mint" /> Climb the ranks
              </CardTitle>
              <CardDescription className="font-medium text-paper/70">
                Separate leaderboards for 10, 20 and 30-item divisions — filtered
                by difficulty, split between Clash and Practice.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="mint" onClick={() => go("leaderboard")}>
                View leaderboards <ArrowUpRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
