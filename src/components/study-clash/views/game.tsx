"use client";

// Gameplay interface: synced questions, server-held answer key revealed only
// after the round locks, ability activation, live scores.
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore, useRouterStore } from "../stores";
import { CharacterIcon } from "../parts/character-chip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getCharacter } from "@/lib/characters";
import { sounds } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import { Loader2, Check, X, Hourglass, Zap, Bot, FastForward, DoorOpen } from "lucide-react";

const CHOICE_LETTERS = ["A", "B", "C", "D"];

function useServerRemaining(endsAt: number | null, offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return undefined;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [endsAt]);
  if (endsAt === null) return null;
  return Math.max(0, endsAt + offset - now);
}

function TimerBar({ endsAt, clockOffset, totalMs }: { endsAt: number; clockOffset: number; totalMs: number }) {
  const remaining = useServerRemaining(endsAt, clockOffset) ?? 0;
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  const seconds = Math.ceil(remaining / 1000);
  const urgent = remaining <= 3000;
  const lastSecond = useRef<number>(-1);

  // Tick sound in the final 3 seconds — game-show pressure.
  useEffect(() => {
    if (seconds !== lastSecond.current) {
      lastSecond.current = seconds;
      if (seconds > 0 && seconds <= 3) sounds.play("urgent");
    }
  }, [seconds]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-5 border-2 border-ink rounded-lg overflow-hidden bg-card shadow-nb-sm">
        <div
          className={cn("h-full transition-[width] duration-100 ease-linear", urgent ? "bg-coral" : "bg-brand")}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Time remaining"
        />
      </div>
      <span
        className={cn(
          "font-display font-bold text-2xl w-12 text-right tabular-nums",
          urgent && "text-coral animate-pulse"
        )}
        aria-live="polite"
      >
        {seconds}s
      </span>
    </div>
  );
}

function PlayerScoreCard({
  player,
  isYou,
  answered,
  roundPoints,
  isRoundLeader,
}: {
  player: { pid: string; name: string; characterId: string; score: number; isAI: boolean; abilityUsed: boolean };
  isYou: boolean;
  answered: boolean;
  roundPoints?: number;
  isRoundLeader?: boolean;
}) {
  const char = getCharacter(player.characterId);
  return (
    <div
      className={cn(
        "border-2 border-ink rounded-xl p-3 sm:p-4 flex items-center gap-3 shadow-nb-sm bg-card min-w-0",
        isYou && "bg-lav/40",
        isRoundLeader && "ring-4 ring-mint"
      )}
    >
      <CharacterIcon characterId={player.characterId} className="size-10 sm:size-12 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-sm truncate flex items-center gap-1.5">
          {player.isAI && <Bot className="size-3.5 shrink-0" />}
          {player.name}
          {isYou && <span className="text-muted-foreground font-medium">(you)</span>}
        </p>
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground truncate">
          {char.name}
          {player.abilityUsed ? " · ability used" : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-display font-bold text-xl sm:text-2xl tabular-nums leading-none" aria-label={`${player.name} score`}>
          {player.score}
          {roundPoints !== undefined && roundPoints > 0 && (
            <span className="text-sm font-bold"> +{roundPoints}</span>
          )}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">pts</p>
      </div>
      {answered && (
        <span className="nb-chip bg-mint text-ink shrink-0 hidden sm:inline-flex">
          <Check className="size-3" /> In
        </span>
      )}
    </div>
  );
}

export default function GameView() {
  const roomState = useGameStore((s) => s.roomState);
  const countdown = useGameStore((s) => s.countdown);
  const question = useGameStore((s) => s.question);
  const myAnswer = useGameStore((s) => s.myAnswer);
  const opponentAnswered = useGameStore((s) => s.opponentAnswered);
  const roundResult = useGameStore((s) => s.roundResult);
  const eliminated = useGameStore((s) => s.eliminated);
  const abilityEffect = useGameStore((s) => s.abilityEffect);
  const clockOffset = useGameStore((s) => s.clockOffset);
  const submitAnswer = useGameStore((s) => s.submitAnswer);
  const activateAbility = useGameStore((s) => s.activateAbility);
  const next = useGameStore((s) => s.next);
  const connected = useGameStore((s) => s.connected);
  const leave = useGameStore((s) => s.leave);
  const disconnect = useGameStore((s) => s.disconnect);
  const go = useRouterStore((s) => s.go);

  const revealRemaining = useServerRemaining(roundResult?.nextAt ?? null, clockOffset);

  const me = useMemo(
    () => roomState?.players.find((p) => p.pid === roomState.you.pid) ?? null,
    [roomState]
  );
  const opponent = useMemo(
    () => roomState?.players.find((p) => p.pid !== roomState.you.pid) ?? null,
    [roomState]
  );

  if (!roomState || !me) {
    return (
      <div className="flex-1 flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const phase = roomState.phase;
  const myRound = roundResult?.results.find((r) => r.pid === me.pid);
  const oppRound = roundResult?.results.find((r) => r.pid === opponent?.pid);
  const myScoreNow = roundResult?.scores.find((s) => s.pid === me.pid)?.score ?? me.score;
  const oppScoreNow = roundResult?.scores.find((s) => s.pid === opponent?.pid)?.score ?? opponent?.score ?? 0;
  const maxScore = Math.max(myScoreNow, oppScoreNow);

  const char = getCharacter(me.characterId);
  const abilityAvailable = !me.abilityUsed && !myAnswer && phase === "question";

  // ---- Fullscreen countdown ----
  if (countdown !== null && phase === "countdown") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-20 px-4">
        <p className="font-display font-bold uppercase tracking-widest text-muted-foreground">
          Starting in
        </p>
        <p className="font-display font-bold text-7xl sm:text-8xl sm:text-[9rem] leading-none bg-brand text-paper border-2 border-ink rounded-2xl px-6 sm:px-8 py-2 shadow-nb-lg tabular-nums">
          {countdown}
        </p>
        <p className="font-bold text-muted-foreground text-center text-sm sm:text-base">
          {roomState.room.questionCount} questions · {roomState.room.difficulty} ·{" "}
          {roomState.room.timerSeconds}s each
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-4 sm:gap-5 max-w-3xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6">
      {/* Top strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="ink" className="text-sm font-display tracking-wider">
          {phase === "reveal" || phase === "question"
            ? `Q${Math.min(
                (question?.index ?? roundResult?.index ?? roomState.qIndex) + 1,
                roomState.room.questionCount
              )} / ${roomState.room.questionCount}`
            : roomState.room.mode === "PRACTICE"
              ? "Practice"
              : "Clash"}
        </Badge>
        <Badge
          variant={
            roomState.room.difficulty === "HARD"
              ? "destructive"
              : roomState.room.difficulty === "NORMAL"
                ? "secondary"
                : "mint"
          }
        >
          {roomState.room.difficulty}
        </Badge>
        {roomState.room.mode === "PRACTICE" && roomState.room.aiLevel && (
          <Badge variant="outline">
            <Bot className="size-3" /> {roomState.room.aiLevel} bot
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <span
            className={cn("size-2.5 rounded-full border border-ink", connected ? "bg-mint" : "bg-coral animate-pulse")}
          />
          <span className="hidden sm:inline">{connected ? "Live" : "Reconnecting"}</span>
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="ml-2 h-8 px-2.5 border-coral text-coral hover:bg-coral hover:text-ink"
              aria-label="Quit match"
              title="Quit match"
            >
              <DoorOpen className="size-4" />
              <span className="hidden sm:inline">Quit</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Quit this match?</AlertDialogTitle>
              <AlertDialogDescription>
                If you quit, the match will be abandoned for both players and it
                won&apos;t count towards the leaderboard. There&apos;s no way to
                rejoin after quitting.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep playing</AlertDialogCancel>
              <AlertDialogAction
                className="bg-coral text-ink hover:bg-coral/80"
                onClick={() => {
                  leave();
                  setTimeout(() => disconnect(), 150);
                  go("dashboard");
                }}
              >
                <DoorOpen className="size-4" /> Quit match
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-3">
        <PlayerScoreCard
          player={me}
          isYou
          answered={myAnswer !== null}
          roundPoints={myRound?.points}
          isRoundLeader={phase === "reveal" && myScoreNow === maxScore && maxScore > 0}
        />
        {opponent && (
          <PlayerScoreCard
            player={opponent}
            isYou={false}
            answered={opponentAnswered.includes(opponent.pid) || (phase === "reveal" && !!oppRound)}
            roundPoints={oppRound?.points}
            isRoundLeader={phase === "reveal" && oppScoreNow === maxScore && maxScore > 0}
          />
        )}
      </div>

      {/* Question phase */}
      {question && phase !== "reveal" && (
        <div className="flex flex-col gap-4">
          <TimerBar endsAt={question.endsAt} clockOffset={clockOffset} totalMs={question.timerMs} />
          <div className="nb-card p-5 sm:p-6">
            <p className="font-display font-bold text-xl sm:text-2xl leading-snug">{question.text}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {question.choices.map((choice, i) => {
              const isEliminated = eliminated.includes(i);
              const isSelected = myAnswer?.choiceIndex === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={myAnswer !== null || isEliminated}
                  onClick={() => {
                    sounds.play("lockIn");
                    submitAnswer(question.index, i);
                  }}
                  aria-label={`Choice ${CHOICE_LETTERS[i]}: ${choice}`}
                  className={cn(
                    "nb-press border-2 border-ink rounded-xl p-4 text-left flex items-center gap-3 shadow-nb-sm bg-card",
                    isSelected && "bg-brand text-paper shadow-nb",
                    isEliminated && "opacity-40 line-through bg-muted cursor-not-allowed",
                    myAnswer !== null && !isSelected && "opacity-70 cursor-default"
                  )}
                >
                  <span
                    className={cn(
                      "size-8 rounded-lg border-2 border-ink font-display font-bold flex items-center justify-center shrink-0",
                      isSelected ? "bg-paper text-ink" : "bg-lav text-ink"
                    )}
                  >
                    {CHOICE_LETTERS[i]}
                  </span>
                  <span className="font-bold text-sm sm:text-base leading-snug">{choice}</span>
                </button>
              );
            })}
          </div>

          {/* Ability + status row */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button
              type="button"
              onClick={activateAbility}
              disabled={!abilityAvailable}
              className={cn(
                "nb-press flex items-center gap-3 border-2 border-ink rounded-xl px-4 py-3 text-left shadow-nb-sm",
                me.abilityUsed ? "bg-muted opacity-70" : "bg-coral/90",
                !abilityAvailable && "cursor-not-allowed"
              )}
              aria-label={`Activate ${char.ability.name}`}
            >
              <Zap className="size-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-display font-bold text-sm uppercase tracking-wide leading-tight">
                  {char.ability.name}
                </p>
                <p className="text-[11px] font-bold uppercase tracking-wider">
                  {me.abilityUsed ? "Used" : myAnswer ? "Answer first!" : "1 use left"}
                </p>
              </div>
            </button>

            <div className="flex-1 min-h-[52px] flex items-center">
              {myAnswer !== null ? (
                <div className="flex items-center gap-2 nb-chip bg-mint w-full justify-center py-2.5">
                  <Hourglass className="size-4 animate-pulse" />
                  Locked in — waiting for opponent…
                </div>
              ) : abilityEffect ? (
                <div className="flex items-center gap-2 nb-chip bg-lav w-full justify-center py-2.5">
                  <Zap className="size-4" />
                  {abilityEffect.ability === "second_chance"
                    ? "Two wrong answers eliminated"
                    : abilityEffect.ability === "quick_reflex"
                      ? `+${Math.round((abilityEffect.addedMs ?? 5000) / 1000)}s added to your clock`
                      : "Bonus armed — answer correctly to cash in"}
                </div>
              ) : (
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Faster correct answers score more
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reveal phase — answer key unlocked by the server */}
      {roundResult && (
        <div className="flex flex-col gap-4">
          <div className="nb-card p-5 sm:p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={myRound?.correct ? "mint" : "destructive"} className="text-sm">
                {myRound?.correct ? (
                  <>
                    <Check className="size-3.5" /> Correct · +{myRound?.points} pts
                  </>
                ) : (
                  <>
                    <X className="size-3.5" />{" "}
                    {myRound?.choiceIndex === null || myRound?.choiceIndex === undefined ? "Time ran out" : "Wrong"}
                  </>
                )}
              </Badge>
              {oppRound && (
                <Badge variant={oppRound.correct ? "mint" : "outline"} className="text-sm">
                  {oppRound.name}: {oppRound.correct ? `correct (+${oppRound.points})` : "missed"}
                </Badge>
              )}
              {myRound && myRound.abilityBonus > 0 && (
                <Badge variant="secondary">Ability bonus +{myRound.abilityBonus}</Badge>
              )}
            </div>

            <p className="font-display font-bold text-lg sm:text-xl leading-snug">
              Q{roundResult.index + 1}. {roundResult.text}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {roundResult.choices.map((choice, i) => {
                const isCorrect = i === roundResult.correctIndex;
                const myPick = myRound?.choiceIndex === i;
                const oppPick = oppRound?.choiceIndex === i;
                return (
                  <div
                    key={i}
                    className={cn(
                      "border-2 border-ink rounded-xl px-4 py-3 flex items-center gap-3",
                      isCorrect ? "bg-mint shadow-nb-sm" : "bg-card opacity-80",
                      myPick && "ring-4 ring-brand/60"
                    )}
                  >
                    <span className="size-7 rounded-lg border-2 border-ink bg-lav font-display font-bold flex items-center justify-center shrink-0 text-sm">
                      {CHOICE_LETTERS[i]}
                    </span>
                    <span className="font-bold text-sm leading-snug flex-1">{choice}</span>
                    {isCorrect && <Check className="size-5 shrink-0" />}
                    {myPick && !isCorrect && <X className="size-5 text-coral shrink-0" />}
                    {oppPick && (
                      <span className="nb-chip bg-card text-ink text-[10px]">{oppRound?.name.split(" ")[0]}</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-2 border-ink rounded-xl bg-lav/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Why</p>
              <p className="text-sm font-medium leading-relaxed mt-1">
                {roundResult.explanation || "No explanation provided."}
              </p>
              {roundResult.sourceRef && (
                <p className="text-xs italic text-muted-foreground mt-2 leading-snug">
                  Source: “{roundResult.sourceRef}”
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ink" className="flex-1" onClick={next}>
                <FastForward className="size-4" /> Next question
              </Button>
              <span className="text-sm font-bold text-muted-foreground tabular-nums w-16 text-right">
                {revealRemaining !== null ? `${Math.ceil(revealRemaining / 1000)}s` : "…"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Transitional states */}
      {!question && !roundResult && phase === "question" && (
        <div className="nb-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="font-bold text-muted-foreground">Loading question…</p>
        </div>
      )}

      {(phase === "lobby" || phase === "countdown") && countdown === null && (
        <div className="nb-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="font-bold">Waiting for the match to start…</p>
        </div>
      )}
    </div>
  );
}
