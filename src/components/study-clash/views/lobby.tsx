"use client";

// Multiplayer lobby: room code + share link, character lock-in, ready-up.
// Includes escape hatches: Leave button, and a cancel path when the socket
// never connects (no infinite spinners).
import { useEffect, useMemo, useState } from "react";
import { useRouterStore, useGameStore } from "../stores";
import { CharacterPicker } from "../parts/character-picker";
import { CharacterChip } from "../parts/character-chip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AI_LEVEL_META, type CharacterId } from "@/lib/characters";
import { sounds } from "@/lib/sounds";
import dynamic from "next/dynamic";
import {
  Copy,
  Check,
  Users,
  Loader2,
  Play,
  DoorOpen,
  Link2,
  Bot,
  Crown,
  CircleAlert,
  ArrowLeft,
} from "lucide-react";

const CharacterStage = dynamic(() => import("../parts/character-stage"), {
  ssr: false,
  loading: () => <div className="h-40" />,
});

export default function LobbyView() {
  const go = useRouterStore((s) => s.go);
  const { toast } = useToast();
  const roomState = useGameStore((s) => s.roomState);
  const connected = useGameStore((s) => s.connected);
  const authError = useGameStore((s) => s.authError);
  const connectError = useGameStore((s) => s.connectError);
  const selectCharacter = useGameStore((s) => s.selectCharacter);
  const setReady = useGameStore((s) => s.setReady);
  const start = useGameStore((s) => s.start);
  const leave = useGameStore((s) => s.leave);
  const disconnect = useGameStore((s) => s.disconnect);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [waited, setWaited] = useState(false);

  const me = useMemo(
    () => roomState?.players.find((p) => p.pid === roomState.you.pid) ?? null,
    [roomState]
  );
  const opponent = useMemo(
    () => roomState?.players.find((p) => p.pid !== roomState.you.pid) ?? null,
    [roomState]
  );

  // Show a cancel option after a short wait so nobody is trapped on a spinner.
  useEffect(() => {
    if (roomState) return;
    const t = window.setTimeout(() => setWaited(true), 5000);
    return () => window.clearTimeout(t);
  }, [roomState]);

  useEffect(() => {
    if (authError) {
      toast({ title: "Connection problem", description: authError, variant: "destructive" });
      disconnect();
      go("dashboard");
    }
  }, [authError, toast, disconnect, go]);

  if (!roomState || !me) {
    const problem = authError ?? connectError;
    return (
      <div className="flex-1 flex items-center justify-center py-24 px-4">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          {problem ? (
            <CircleAlert className="size-10 text-coral" />
          ) : (
            <Loader2 className="size-10 animate-spin" />
          )}
          <p className="font-bold uppercase tracking-widest text-sm">
            {problem ?? "Connecting to room…"}
          </p>
          {(problem || waited) && (
            <Button
              variant="outline"
              onClick={() => {
                disconnect();
                go("dashboard");
              }}
            >
              <ArrowLeft className="size-4" /> Back to dashboard
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isPractice = roomState.room.mode === "PRACTICE";
  const humans = roomState.players.filter((p) => !p.isAI);
  const allReady = roomState.players.every((p) => p.ready);
  const canStart = me.isHost && allReady && (isPractice || humans.length >= 2);

  const copy = async (what: "code" | "link") => {
    try {
      const text =
        what === "code"
          ? roomState.room.code
          : `${window.location.origin}/?join=${roomState.room.code}`;
      await navigator.clipboard.writeText(text);
      setCopied(what);
      sounds.play("select");
      setTimeout(() => setCopied(null), 1600);
      toast({ title: what === "code" ? "Room code copied" : "Invite link copied", description: text });
    } catch {
      toast({ title: "Copy failed", description: "Copy it manually: " + roomState.room.code, variant: "destructive" });
    }
  };

  const handleLeave = () => {
    leave();
    setTimeout(() => disconnect(), 150);
    go("dashboard");
  };

  const handleReady = () => {
    sounds.play("ready");
    setReady(!me.ready);
  };

  return (
    <div className="flex-1 flex flex-col gap-4 sm:gap-6 max-w-4xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6">
      {/* Room header */}
      <div className="nb-card p-4 sm:p-6 bg-brand text-paper">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-paper/70">
              {isPractice ? "Practice room" : "Clash room"}
            </p>
            <p className="font-display font-bold text-3xl sm:text-5xl tracking-[0.25em] mt-1 drop-shadow-[3px_3px_0_rgba(23,23,23,0.9)]">
              {roomState.room.code}
            </p>
          </div>
          <div className="flex gap-2 sm:ml-auto flex-wrap">
            {!isPractice && (
              <>
                <Button variant="mint" onClick={() => void copy("code")}>
                  {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
                  <span className="hidden sm:inline">Copy code</span>
                  <span className="sm:hidden">Code</span>
                </Button>
                <Button variant="secondary" onClick={() => void copy("link")}>
                  {copied === "link" ? <Check className="size-4" /> : <Link2 className="size-4" />}
                  <span className="hidden sm:inline">Invite link</span>
                  <span className="sm:hidden">Invite</span>
                </Button>
              </>
            )}
            <Button variant="outline" onClick={handleLeave}>
              <DoorOpen className="size-4" /> Leave
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="nb-chip bg-paper text-ink">{roomState.room.questionCount} items</span>
          <span className="nb-chip bg-paper text-ink">{roomState.room.difficulty} difficulty</span>
          <span className="nb-chip bg-paper text-ink">{roomState.room.timerSeconds}s timer</span>
          <span className="nb-chip bg-paper text-ink truncate max-w-[220px]">{roomState.room.documentName}</span>
          {isPractice && roomState.room.aiLevel && (
            <span className="nb-chip bg-mint text-ink">
              <Bot className="size-3" /> {AI_LEVEL_META[roomState.room.aiLevel as keyof typeof AI_LEVEL_META]?.label ?? roomState.room.aiLevel}
            </span>
          )}
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 items-start">
        {/* You */}
        <div className="nb-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-display font-bold text-lg uppercase tracking-wide flex items-center gap-2">
              <Crown className="size-4" /> You {me.isHost && "(host)"}
            </h2>
            {me.ready ? <Badge variant="mint">Ready</Badge> : <Badge variant="outline">Not ready</Badge>}
          </div>
          <CharacterPicker
            value={me.characterId as CharacterId}
            onChange={(id) => selectCharacter(id)}
            compact
          />
          <div className="flex gap-2 mt-4">
            <Button
              className="flex-1"
              size="lg"
              variant={me.ready ? "secondary" : "default"}
              onClick={handleReady}
            >
              {me.ready ? "Stand down" : "I'm ready"}
            </Button>
          </div>
        </div>

        {/* Opponent */}
        <div className="nb-card p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg uppercase tracking-wide flex items-center gap-2">
              <Users className="size-4" /> Opponent
            </h2>
            {opponent ? (
              opponent.ready ? <Badge variant="mint">Ready</Badge> : <Badge variant="outline">Not ready</Badge>
            ) : (
              <Badge variant="destructive">Waiting…</Badge>
            )}
          </div>

          {opponent ? (
            <div className="flex flex-col gap-4">
              <div className="bg-lav/50 border-2 border-ink rounded-xl overflow-hidden">
                <CharacterStage
                  key={opponent.characterId}
                  characters={[{ id: opponent.characterId, scale: 1.05 }]}
                  className="h-36 sm:h-40"
                  cameraZ={2.1}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold truncate flex items-center gap-2">
                    {opponent.name}
                    {opponent.isAI && <Bot className="size-4 shrink-0" />}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium">
                    {opponent.isAI
                      ? "Server-side bot · answers with realistic delays"
                      : opponent.connected
                        ? "Connected"
                        : "Reconnecting…"}
                  </p>
                </div>
                <CharacterChip characterId={opponent.characterId} showName={false} />
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-ink/30 rounded-xl p-6 sm:p-8 text-center">
              <Loader2 className="size-8 mx-auto animate-spin text-muted-foreground" />
              <p className="font-bold mt-3">Waiting for a challenger…</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                Share the room code or the invite link above.
              </p>
            </div>
          )}

          {me.isHost && (
            <Button size="xl" variant="ink" disabled={!canStart} onClick={start} className="mt-auto">
              <Play className="size-5" />
              {isPractice ? "Start practice" : "Start clash"}
            </Button>
          )}
          {!me.isHost && (
            <p className="text-xs text-muted-foreground font-medium text-center mt-auto">
              Waiting for the host to start the match.
            </p>
          )}
        </div>
      </div>

      {/* Connection warning */}
      {!connected && (
        <div className="nb-card p-4 bg-coral flex items-center gap-3">
          <CircleAlert className="size-5" />
          <p className="text-sm font-bold">
            Connection lost — trying to reconnect. Keep this tab open.
          </p>
        </div>
      )}
    </div>
  );
}
