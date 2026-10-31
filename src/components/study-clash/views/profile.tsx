"use client";

// Player profile: lifetime statistics and match history.
import { useProfile } from "../hooks";
import { CharacterIcon } from "../parts/character-chip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouterStore } from "../stores";
import { Button } from "@/components/ui/button";
import { formatAccuracy, formatMs } from "../api";
import {
  Swords,
  Bot,
  Target,
  Zap,
  CalendarDays,
  FileStack,
  Trophy,
  ArrowUpRight,
} from "lucide-react";

function BigStat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="nb-card p-4 flex items-center gap-3">
      <span className={`${accent} border-2 border-ink rounded-lg p-2 shrink-0`}>
        <Icon className="size-5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-display font-bold text-xl leading-tight truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground font-medium truncate">{sub}</p>}
      </div>
    </div>
  );
}

export default function ProfileView() {
  const go = useRouterStore((s) => s.go);
  const { profile, loading } = useProfile();

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-28 rounded-xl bg-muted" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-muted" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl bg-muted" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="nb-card p-8 text-center">
        <p className="font-bold">Could not load your profile.</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="nb-card p-6 flex flex-col sm:flex-row sm:items-center gap-5 bg-lav/40">
        {profile.favoriteCharacter && (
          <CharacterIcon characterId={profile.favoriteCharacter} className="size-16 rounded-xl" />
        )}
        <div className="min-w-0">
          <h1 className="font-display font-bold text-3xl tracking-tight truncate">@{profile.username}</h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline">
              <CalendarDays className="size-3" /> Since {new Date(profile.memberSince).toLocaleDateString()}
            </Badge>
            {profile.favoriteCharacter && (
              <Badge variant="secondary">Main: {profile.favoriteCharacter.replace(/_/g, " ")}</Badge>
            )}
            {profile.bestDifficulty && (
              <Badge variant="mint">Best at {profile.bestDifficulty}</Badge>
            )}
            <Badge variant="outline">
              <FileStack className="size-3" /> {profile.documents} docs · {profile.quizzes} quizzes
            </Badge>
          </div>
        </div>
        <Button variant="ink" className="sm:ml-auto" onClick={() => go("leaderboard")}>
          <Trophy className="size-4" /> View ranks <ArrowUpRight className="size-4" />
        </Button>
      </div>

      {/* Lifetime stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BigStat
          icon={Swords}
          label="Clash record"
          value={`${profile.clashWins}W / ${profile.clashGames - profile.clashWins}L`}
          sub={`${profile.clashGames} multiplayer games`}
          accent="bg-coral"
        />
        <BigStat
          icon={Bot}
          label="Practice record"
          value={`${profile.practiceWins}W / ${profile.practiceGames - profile.practiceWins}L`}
          sub={`${profile.practiceGames} practice games`}
          accent="bg-mint"
        />
        <BigStat
          icon={Target}
          label="Overall accuracy"
          value={formatAccuracy(profile.overallAccuracy)}
          sub={`${profile.totalGames} completed games`}
          accent="bg-lav"
        />
        <BigStat
          icon={Zap}
          label="Best score"
          value={`${profile.bestScore}`}
          sub="points in one match"
          accent="bg-card"
        />
      </div>

      {/* Division performance */}
      <div className="nb-card p-5">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-4">
          Performance by division
        </h2>
        <div className="flex flex-col gap-4">
          {profile.divisionStats.map((d) => (
            <div key={d.division} className="flex items-center gap-3">
              <span className="font-display font-bold text-sm w-16 shrink-0">{d.division} items</span>
              <div className="flex-1 h-6 border-2 border-ink rounded-lg overflow-hidden bg-muted">
                <div
                  className="h-full bg-brand flex items-center justify-end pr-2"
                  style={{ width: `${Math.max(d.games > 0 ? Math.round(d.accuracy * 100) : 0, d.games > 0 ? 8 : 0)}%` }}
                  role="img"
                  aria-label={`${d.division} item accuracy ${formatAccuracy(d.accuracy)}`}
                >
                  {d.games > 0 && (
                    <span className="text-[10px] font-bold text-paper">{formatAccuracy(d.accuracy)}</span>
                  )}
                </div>
              </div>
              <span className="text-xs font-bold text-muted-foreground w-24 text-right shrink-0">
                {d.games} game{d.games === 1 ? "" : "s"}
                {d.bestScore > 0 && ` · best ${d.bestScore}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Match history */}
      <div className="nb-card p-5">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide mb-3">Match history</h2>
        {profile.recentGames.length === 0 ? (
          <p className="text-sm text-muted-foreground font-medium py-6 text-center">
            No completed matches yet — your history will build up here.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto scrollbar-nb pr-1">
            {profile.recentGames.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 py-3 border-b-2 border-dashed border-ink/15 last:border-0"
              >
                <span className={`nb-chip ${g.won ? "bg-mint" : "bg-coral"} text-ink shrink-0`}>
                  {g.won ? "Won" : "Lost"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">
                    {g.mode === "CLASH" ? "Clash" : "Practice"} vs {g.opponentName}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium">
                    {g.questionCount} items · {g.difficulty} · {g.score} pts ·{" "}
                    {formatAccuracy(g.accuracy)} · avg {formatMs(g.avgTimeMs)}
                    {g.abilityUsed && " · ability used"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <CharacterIcon characterId={g.characterId} className="size-8" />
                  <p className="text-[10px] font-bold text-muted-foreground mt-1">
                    {new Date(g.finishedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
