"use client";

// Leaderboards: separate divisions per question count, difficulty filters,
// and a strict split between Clash (competitive) and Practice records.
import { useCallback, useEffect, useState } from "react";
import { api, formatAccuracy } from "../api";
import { CharacterIcon } from "../parts/character-chip";
import { OptionGroup } from "../parts/option-selector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "next-auth/react";
import type { LeaderboardEntry } from "@/lib/types";
import { Swords, Bot, Trophy, Medal, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "clash" | "practice";
type DifficultyFilter = "ALL" | "EASY" | "NORMAL" | "HARD";

export default function LeaderboardView() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>("clash");
  const [division, setDivision] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("ALL");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<LeaderboardEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ entries: LeaderboardEntry[]; me: LeaderboardEntry | null }>(
        `/api/leaderboard?division=${division}&difficulty=${difficulty}&mode=${mode}`
      );
      setEntries(data.entries);
      setMe(data.me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard.");
    } finally {
      setLoading(false);
    }
  }, [division, difficulty, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const myId = session?.user?.id as string | undefined;

  const rankBadge = (rank: number) => {
    if (rank === 1) return <Trophy className="size-5 text-brand" />;
    if (rank === 2) return <Medal className="size-5" />;
    if (rank === 3) return <Medal className="size-5 text-coral" />;
    return <span className="font-display font-bold text-muted-foreground w-6 text-center">{rank}</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight flex items-center gap-3">
          <span className="bg-lav border-2 border-ink rounded-lg p-2 shadow-nb-sm">
            <Trophy className="size-6" />
          </span>
          Leaderboards
        </h1>
        <p className="text-muted-foreground font-medium mt-1">
          Rankings from completed matches only. Ranked by total points,
          tie-broken by accuracy. Practice bots never appear here.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            variant={mode === "clash" ? "ink" : "outline"}
            size="lg"
            onClick={() => setMode("clash")}
            className="flex-1 sm:flex-none"
          >
            <Swords className="size-4" /> Clash rankings
          </Button>
          <Button
            variant={mode === "practice" ? "ink" : "outline"}
            size="lg"
            onClick={() => setMode("practice")}
            className="flex-1 sm:flex-none"
          >
            <Bot className="size-4" /> Practice rankings
          </Button>
        </div>

        <OptionGroup
          label="Question count division"
          options={[
            { value: 10, label: "10 items" },
            { value: 20, label: "20 items" },
            { value: 30, label: "30 items" },
          ]}
          value={division}
          onChange={setDivision}
        />

        <OptionGroup
          label="Quiz difficulty"
          options={[
            { value: "ALL", label: "All", hint: "Mixed" },
            { value: "EASY", label: "Easy" },
            { value: "NORMAL", label: "Normal" },
            { value: "HARD", label: "Hard" },
          ]}
          value={difficulty}
          onChange={setDifficulty}
          accent="bg-lav"
          columns={4}
        />
      </div>

      {/* My rank card */}
      {me && (
        <div className="nb-card p-4 bg-lav/50 flex items-center gap-4">
          <span className="font-display font-bold text-2xl tabular-nums w-10 text-center">
            #{me.rank}
          </span>
          <CharacterIcon characterId={me.characterId} />
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">
              @{me.username} <span className="text-muted-foreground font-medium">(you)</span>
            </p>
            <p className="text-xs font-medium text-muted-foreground">
              {me.totalPoints} pts · {formatAccuracy(me.accuracy)} accuracy · {me.games} games
            </p>
          </div>
          <Badge variant="ink">{me.wins} wins</Badge>
        </div>
      )}

      {/* Table */}
      {error && (
        <div className="nb-card p-4 bg-coral flex items-center gap-3">
          <CircleAlert className="size-5" /> {error}
        </div>
      )}

      <div className="nb-card overflow-hidden py-0 gap-0">
        <div className="grid grid-cols-[3rem_1fr_5rem_4.5rem_3.5rem_3.5rem] sm:grid-cols-[3.5rem_1fr_6rem_6rem_4.5rem_4.5rem] gap-2 px-4 py-3 border-b-2 border-ink bg-ink text-paper text-[11px] font-bold uppercase tracking-wider">
          <span className="text-center">#</span>
          <span>Player</span>
          <span className="text-right">Points</span>
          <span className="text-right hidden sm:block">Accuracy</span>
          <span className="text-right">Games</span>
          <span className="text-right">Wins</span>
        </div>
        <div className="max-h-[28rem] overflow-y-auto scrollbar-nb">
          {loading ? (
            <div className="p-4 flex flex-col gap-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg bg-muted" />
              ))}
            </div>
          ) : entries && entries.length > 0 ? (
            entries.map((entry) => {
              const isMe = entry.userId === myId;
              return (
                <div
                  key={entry.userId}
                  className={cn(
                    "grid grid-cols-[3rem_1fr_5rem_4.5rem_3.5rem_3.5rem] sm:grid-cols-[3.5rem_1fr_6rem_6rem_4.5rem_4.5rem] gap-2 px-4 py-3 border-b-2 border-dashed border-ink/10 last:border-0 items-center",
                    isMe && "bg-lav/50"
                  )}
                >
                  <span className="flex justify-center">{rankBadge(entry.rank)}</span>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CharacterIcon characterId={entry.characterId} className="size-8" />
                    <span className="font-bold text-sm truncate">@{entry.username}</span>
                  </div>
                  <span className="text-right font-display font-bold tabular-nums">
                    {entry.totalPoints}
                  </span>
                  <span className="text-right font-bold text-sm tabular-nums hidden sm:block">
                    {formatAccuracy(entry.accuracy)}
                  </span>
                  <span className="text-right font-bold text-sm tabular-nums">{entry.games}</span>
                  <span className="text-right font-bold text-sm tabular-nums">{entry.wins}</span>
                </div>
              );
            })
          ) : (
            <div className="p-10 text-center">
              <p className="font-display font-bold text-lg uppercase">No completed games yet</p>
              <p className="text-sm text-muted-foreground font-medium mt-1">
                Finish a {mode === "clash" ? "clash" : "practice"} match at {division} items
                {difficulty !== "ALL" ? ` on ${difficulty}` : ""} to appear here.
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground font-medium">
        Ranking rules: total points first, accuracy as tie-breaker, fewer games
        played as the final tie-breaker. Incomplete or abandoned matches never
        enter the rankings.
      </p>
    </div>
  );
}
