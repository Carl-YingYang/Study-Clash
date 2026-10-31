"use client";

// PRACTICE MODE setup: pick quiz → timer → character → AI level → start.
// The AI level is independent from the quiz difficulty.
import { useState } from "react";
import { useRouterStore, useGameStore } from "../stores";
import { api } from "../api";
import { QuizPicker } from "../parts/quiz-picker";
import { CharacterPicker } from "../parts/character-picker";
import { OptionGroup } from "../parts/option-selector";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import type { QuizSummary, RoomInfo } from "@/lib/types";
import type { AILevel, CharacterId } from "@/lib/characters";
import { AI_LEVEL_META } from "@/lib/characters";
import { Bot, Loader2, Play, Info } from "lucide-react";
import { sounds } from "@/lib/sounds";

const AI_OPTIONS: Array<{ value: AILevel; label: string; hint: string }> = [
  { value: "EASY", label: "Easy", hint: "Often wrong, slow answers" },
  { value: "MID", label: "Mid", hint: "Solid on basics" },
  { value: "HARD", label: "Hard", hint: "Rarely misses" },
  { value: "GENIUS", label: "Genius", hint: "Brutal. Fast. Precise." },
];

export default function PracticeSetupView() {
  const go = useRouterStore((s) => s.go);
  const params = useRouterStore((s) => s.params);
  const connectGame = useGameStore((s) => s.connect);
  const { data: session } = useSession();
  const { toast } = useToast();

  const [quiz, setQuiz] = useState<QuizSummary | null>(null);
  const [timer, setTimer] = useState<number>(15);
  const [characterId, setCharacterId] = useState<CharacterId>(
    (session?.user as { characterId?: CharacterId } | undefined)?.characterId ?? "thinker"
  );
  const [aiLevel, setAiLevel] = useState<AILevel>("MID");
  const [starting, setStarting] = useState(false);

  async function handleStart() {
    if (!quiz || starting) return;
    setStarting(true);
    try {
      const data = await api<{ room: RoomInfo; token: string }>("/api/game/practice", {
        method: "POST",
        body: JSON.stringify({
          quizId: quiz.id,
          timerSeconds: timer,
          aiLevel,
          characterId,
        }),
      });
      sounds.play("success");
      connectGame(data.token);
      toast({
        title: "Practice match created",
        description: `Facing the ${AI_LEVEL_META[aiLevel].label} — good luck.`,
      });
      go("lobby");
    } catch (err) {
      toast({
        title: "Could not start practice",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight flex items-center gap-3">
          <span className="bg-mint border-2 border-ink rounded-lg p-2 shadow-nb-sm">
            <Bot className="size-6" />
          </span>
          Practice Mode
        </h1>
        <p className="text-muted-foreground font-medium mt-1">
          Solo match against a server-side bot that answers the same questions
          through the same scoring rules. No human needed.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="font-display font-bold text-lg uppercase tracking-wide">1 · Choose a quiz</p>
          <QuizPicker
            value={quiz}
            onChange={(q) => {
              setQuiz(q);
              if (q) go("practice", { quizId: q.id });
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-display font-bold text-lg uppercase tracking-wide">2 · Timer per question</p>
          <OptionGroup
            label="How long do you get per question?"
            options={[
              { value: 10, label: "10s", hint: "Lightning" },
              { value: 15, label: "15s", hint: "Standard" },
              { value: 20, label: "20s", hint: "Relaxed" },
            ]}
            value={timer}
            onChange={setTimer}
            accent="bg-mint"
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-display font-bold text-lg uppercase tracking-wide">3 · Choose your character</p>
          <CharacterPicker value={characterId} onChange={setCharacterId} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display font-bold text-lg uppercase tracking-wide">4 · Pick your opponent</p>
            <span className="nb-chip bg-lav text-ink font-medium normal-case tracking-normal">
              <Info className="size-3" />
              Bot level is separate from quiz difficulty
            </span>
          </div>
          <OptionGroup
            label={`Facing the ${AI_LEVEL_META[aiLevel].label}`}
            options={AI_OPTIONS}
            value={aiLevel}
            onChange={setAiLevel}
            accent="bg-mint"
            columns={4}
          />
          <p className="text-xs text-muted-foreground font-medium">
            {AI_LEVEL_META[aiLevel].blurb} Example: Hard quiz + Easy bot = tough
            questions, beatable opponent.
          </p>
        </div>

        <Button size="xl" variant="ink" onClick={() => void handleStart()} disabled={!quiz || starting} className="mt-1">
          {starting ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
          {starting ? "Setting up…" : "Start practice match"}
        </Button>
        {quiz && (
          <p className="text-xs text-muted-foreground font-medium text-center">
            {quiz.questionCount} {quiz.difficulty} questions · {timer}s timer · vs {AI_LEVEL_META[aiLevel].label}
          </p>
        )}
      </div>
    </div>
  );
}
