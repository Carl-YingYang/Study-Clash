"use client";

// CLASH MODE setup: pick quiz → timer → character → create room.
// Includes the "join with code" panel for guests (prefilled from invite links).
import { useEffect, useState } from "react";
import { useRouterStore, useGameStore } from "../stores";
import { api } from "../api";
import { QuizPicker } from "../parts/quiz-picker";
import { CharacterPicker } from "../parts/character-picker";
import { OptionGroup } from "../parts/option-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import type { QuizSummary, RoomInfo } from "@/lib/types";
import type { CharacterId } from "@/lib/characters";
import { Swords, Loader2, LogIn, Zap } from "lucide-react";
import { sounds } from "@/lib/sounds";

export default function ClashSetupView() {
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
  const [creating, setCreating] = useState(false);

  // Join panel
  const [joinCode, setJoinCode] = useState(params.joinCode ?? "");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (params.quizId) {
      // Preselect will happen once documents load inside QuizPicker; simplest:
      // store the desired id and match in a small effect below.
    }
  }, [params.quizId]);

  async function handleCreate() {
    if (!quiz || creating) return;
    setCreating(true);
    try {
      const data = await api<{ room: RoomInfo; token: string }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ quizId: quiz.id, timerSeconds: timer, characterId }),
      });
      sounds.play("success");
      connectGame(data.token);
      toast({
        title: "Room created",
        description: `Share code ${data.room.code} — waiting for your opponent.`,
      });
      go("lobby");
    } catch (err) {
      toast({
        title: "Could not create room",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4 || joining) return;
    setJoining(true);
    try {
      const data = await api<{ room: RoomInfo; token: string }>("/api/rooms/join", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      sounds.play("join");
      connectGame(data.token);
      toast({
        title: `Joined room ${data.room.code}`,
        description: "Pick your character and get ready.",
      });
      go("lobby");
    } catch (err) {
      toast({
        title: "Could not join",
        description: err instanceof Error ? err.message : "Check the code and try again.",
        variant: "destructive",
      });
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight flex items-center gap-3">
          <span className="bg-brand text-paper border-2 border-ink rounded-lg p-2 shadow-nb-sm">
            <Swords className="size-6" />
          </span>
          Clash Mode
        </h1>
        <p className="text-muted-foreground font-medium mt-1">
          Real 1v1 multiplayer. Same questions, same timer, server-scored — the
          answer key never reaches a browser until the round locks.
        </p>
      </div>

      {/* Join an existing room */}
      <form onSubmit={handleJoin} className="nb-card p-5">
        <Label htmlFor="join-code" className="font-display font-bold uppercase tracking-wide text-base">
          Have a room code?
        </Label>
        <div className="flex gap-2 mt-3">
          <Input
            id="join-code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={8}
            className="font-display tracking-[0.3em] uppercase text-lg"
          />
          <Button type="submit" size="lg" disabled={joining || joinCode.trim().length < 4}>
            {joining ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            Join
          </Button>
        </div>
      </form>

      <div className="h-0.5 bg-ink/15 rounded-full" role="separator" />

      {/* Host flow */}
      <div className="flex flex-col gap-5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Or host your own clash
        </p>

        <div className="flex flex-col gap-2">
          <p className="font-display font-bold text-lg uppercase tracking-wide">1 · Choose a quiz</p>
          <QuizPicker
            value={quiz}
            onChange={(q) => {
              setQuiz(q);
              if (q) go("clash", { quizId: q.id, ...(params.joinCode ? { joinCode: params.joinCode } : {}) });
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
            accent="bg-coral"
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-display font-bold text-lg uppercase tracking-wide">3 · Choose your character</p>
          <CharacterPicker value={characterId} onChange={setCharacterId} />
        </div>

        <Button size="xl" onClick={() => void handleCreate()} disabled={!quiz || creating} className="mt-1">
          {creating ? <Loader2 className="size-5 animate-spin" /> : <Zap className="size-5" />}
          {creating ? "Creating room…" : "Create clash room"}
        </Button>
        {quiz && (
          <p className="text-xs text-muted-foreground font-medium text-center">
            {quiz.questionCount} {quiz.difficulty} questions from “{quiz.documentName}” · {timer}s timer
          </p>
        )}
      </div>
    </div>
  );
}
