"use client";

// Results screen: winner, final scores, stats, question-by-question review.
import { useMemo } from "react";
import { useRouterStore, useGameStore } from "../stores";
import { CharacterIcon } from "../parts/character-chip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCharacter } from "@/lib/characters";
import { formatAccuracy, formatMs } from "../api";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import {
  Trophy,
  Crown,
  Swords,
  Bot,
  RotateCcw,
  Play,
  LayoutDashboard,
  ChevronDown,
  Bot as BotIcon,
  Timer,
  Target,
  Zap,
} from "lucide-react";

const CharacterStage = dynamic(() => import("../parts/character-stage"), {
  ssr: false,
  loading: () => <div className="h-48 sm:h-64" />,
});

export default function ResultsView() {
  const go = useRouterStore((s) => s.go);
  const gameOver = useGameStore((s) => s.gameOver);
  const roomState = useGameStore((s) => s.roomState);
  const rematch = useGameStore((s) => s.rematch);
  const disconnect = useGameStore((s) => s.disconnect);

  const myPid = roomState?.you.pid;
  const me = useMemo(() => gameOver?.results.find((r) => r.pid === myPid) ?? null, [gameOver, myPid]);
  const opponent = useMemo(
    () => gameOver?.results.find((r) => r.pid !== myPid) ?? null,
    [gameOver, myPid]
  );

  if (!gameOver || !me) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-24 px-4 text-center">
        <p className="font-display font-bold text-2xl uppercase">No results to show</p>
        <p className="text-sm text-muted-foreground font-medium max-w-sm">
          The match record is gone (you may have reloaded after an abandoned
          game). Head back to the dashboard to start another one.
        </p>
        <Button onClick={() => go("dashboard")}>
          <LayoutDashboard className="size-4" /> Dashboard
        </Button>
      </div>
    );
  }

  const isDraw = !me.won && !opponent?.won;
  const isPractice = gameOver.mode === "PRACTICE";
  const feedback =
    me.accuracy >= 0.9
      ? "You clearly know this material. Try a harder difficulty or a Genius bot."
      : me.accuracy >= 0.7
        ? "Solid work — review the misses below and you'll be untouchable."
        : me.accuracy >= 0.4
          ? "You know the basics. Focus on the explanations below before the rematch."
          : "This material needs another study pass — read the review below carefully.";

  const podiumCharacters = [
    { id: me.characterId, scale: me.won || isDraw ? 1 : 0.85 },
    ...(opponent ? [{ id: opponent.characterId, scale: opponent.won ? 1 : 0.85 }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* Winner banner */}
      <div
        className={cn(
          "border-2 border-ink rounded-2xl shadow-nb-lg p-6 sm:p-8 text-center",
          me.won ? "bg-mint" : isDraw ? "bg-lav" : "bg-coral/80"
        )}
      >
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-ink/70">
          {isPractice ? "Practice complete" : "Clash complete"}
        </p>
        <h1 className="font-display font-bold text-4xl sm:text-5xl tracking-tight mt-2 flex items-center justify-center gap-3">
          {me.won ? (
            <>
              <Crown className="size-9" /> You win!
            </>
          ) : isDraw ? (
            "It's a draw"
          ) : (
            <>
              {opponent?.name} wins
              {opponent?.isAI && <Bot className="size-8" />}
            </>
          )}
        </h1>
        <p className="font-display font-bold text-xl sm:text-2xl mt-3 tabular-nums">
          {me.score} — {opponent?.score ?? 0}
        </p>
      </div>

      {/* Podium */}
      <div className="relative bg-lav/40 border-2 border-ink rounded-2xl overflow-hidden shadow-nb">
        <CharacterStage characters={podiumCharacters} className="h-48 sm:h-64" cameraZ={2.6} />
      </div>

      {/* Player stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[me, opponent].filter(Boolean).map((r) => {
          const isMe = r === me;
          if (!r) return null;
          return (
            <div key={r.pid} className={cn("nb-card p-5", isMe && "bg-lav/30")}>
              <div className="flex items-center gap-3 mb-4">
                <CharacterIcon characterId={r.characterId} className="size-12 rounded-lg" />
                <div className="min-w-0">
                  <p className="font-display font-bold text-lg uppercase truncate flex items-center gap-2">
                    {r.name} {r.isAI && <BotIcon className="size-4" />}
                    {r.won && <Crown className="size-4 text-brand shrink-0" />}
                  </p>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {getCharacter(r.characterId).name} · {isMe ? "you" : "opponent"}
                  </p>
                </div>
                <p className="ml-auto font-display font-bold text-3xl tabular-nums">{r.score}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="border-2 border-ink rounded-lg py-2 bg-card">
                  <p className="font-display font-bold text-lg leading-none">{formatAccuracy(r.accuracy)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Accuracy</p>
                </div>
                <div className="border-2 border-ink rounded-lg py-2 bg-card">
                  <p className="font-display font-bold text-lg leading-none">
                    {r.correctCount}/{r.totalQuestions}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Correct</p>
                </div>
                <div className="border-2 border-ink rounded-lg py-2 bg-card">
                  <p className="font-display font-bold text-lg leading-none">{formatMs(r.avgTimeMs)}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg time</p>
                </div>
              </div>
              {r.abilityUsed && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mt-3 flex items-center gap-1.5">
                  <Zap className="size-3" /> {getCharacter(r.characterId).ability.name} used
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Practice feedback */}
      {isPractice && (
        <div className="nb-card p-5 bg-lav/50">
          <p className="font-display font-bold uppercase tracking-wide flex items-center gap-2 mb-1">
            <Target className="size-4" /> Coach notes
          </p>
          <p className="text-sm font-medium">{feedback}</p>
          <p className="text-xs text-muted-foreground font-medium mt-2">
            Match settings: {me.totalQuestions} items · reviewed below with full explanations.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {roomState?.you.isHost ? (
          <Button
            size="lg"
            variant="ink"
            onClick={() => {
              rematch();
              go("lobby");
            }}
          >
            <RotateCcw className="size-4" /> Rematch
          </Button>
        ) : (
          <Button
            size="lg"
            variant="ink"
            disabled
            title="Only the host can trigger a rematch — ask them!"
          >
            <RotateCcw className="size-4" /> Rematch (host only)
          </Button>
        )}
        <Button
          size="lg"
          onClick={() => {
            disconnect();
            go(isPractice ? "practice" : "clash");
          }}
        >
          <Play className="size-4" /> New {isPractice ? "practice" : "clash"}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => go("leaderboard")}>
          <Trophy className="size-4" /> Leaderboard
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            disconnect();
            go("dashboard");
          }}
        >
          <LayoutDashboard className="size-4" /> Dashboard
        </Button>
      </div>

      {/* Review */}
      <div className="flex flex-col gap-3" id="review">
        <h2 className="font-display font-bold text-2xl uppercase tracking-tight flex items-center gap-2">
          <Swords className="size-5" /> Answer review
        </h2>
        <p className="text-sm text-muted-foreground font-medium -mt-2">
          Every question, both answers, and the explanation. The answer key is
          only available now that the match is over.
        </p>
        {gameOver.review.map((item) => {
          const myAns = item.answers.find((a) => a.pid === myPid);
          const oppAns = item.answers.find((a) => a.pid !== myPid);
          return (
            <details key={item.index} className="nb-card p-0 group">
              <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer list-none">
                <span className="font-display font-bold text-sm text-muted-foreground tabular-nums w-8">
                  Q{item.index + 1}
                </span>
                <span className="font-bold text-sm flex-1 min-w-0 truncate">{item.text}</span>
                {myAns?.correct ? (
                  <Badge variant="mint" className="shrink-0">
                    <ChevronDown data-hide-when-open className="size-3 hidden group-open:hidden" />
                    +{myAns.points}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="shrink-0">
                    {myAns?.choiceIndex === null || myAns?.choiceIndex === undefined ? "timeout" : "wrong"}
                  </Badge>
                )}
                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 flex flex-col gap-2.5 border-t-2 border-dashed border-ink/20 pt-3">
                <p className="font-medium text-sm">{item.text}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {item.choices.map((choice, i) => {
                    const isCorrect = i === item.correctIndex;
                    const mine = myAns?.choiceIndex === i;
                    const theirs = oppAns?.choiceIndex === i;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "border-2 border-ink rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2",
                          isCorrect ? "bg-mint" : "bg-card",
                          mine && "ring-4 ring-brand/50"
                        )}
                      >
                        <span className="font-display font-bold">{"ABCD"[i]}</span>
                        <span className="flex-1 leading-snug">{choice}</span>
                        {mine && <span className="nb-chip bg-brand text-paper text-[10px]">You</span>}
                        {theirs && (
                          <span className="nb-chip bg-ink text-paper text-[10px]">
                            {oppAns?.name.split(" ")[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm font-medium leading-relaxed border-2 border-ink rounded-lg bg-lav/30 px-3 py-2">
                  {item.explanation || "No explanation provided."}
                </p>
                {item.sourceRef && (
                  <p className="text-xs italic text-muted-foreground">Source: “{item.sourceRef}”</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
