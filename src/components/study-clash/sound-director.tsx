"use client";

// STUDY CLASH — Sound director.
// ---------------------------------------------------------------------------
// A single mounted component that translates game-store transitions into
// sound effects, plus a global soft click for interactive elements. All audio
// is synthesized in lib/sounds.ts — no files, no network.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { useGameStore } from "./stores";
import { sounds } from "@/lib/sounds";

export function SoundDirector() {
  useEffect(() => {
    const unsub = useGameStore.subscribe((state, prev) => {
      // ---- Connection ----
      if (!prev.connected && state.connected) sounds.play("toggle");

      // ---- Countdown ticks ----
      if (state.countdown !== prev.countdown && state.countdown !== null) {
        sounds.play("countdown");
      }

      // ---- New question ----
      if (!prev.question && state.question) {
        sounds.play("question");
      }

      // ---- Round result → correct / wrong ----
      if (!prev.roundResult && state.roundResult) {
        const myPid = state.roomState?.you.pid;
        const mine = state.roundResult.results.find((r) => r.pid === myPid);
        if (mine) sounds.play(mine.correct ? "correct" : "wrong");
        else sounds.play("reveal");
      }

      // ---- Game over → victory / defeat / draw ----
      if (!prev.gameOver && state.gameOver) {
        const myPid = state.roomState?.you.pid;
        const me = state.gameOver.results.find((r) => r.pid === myPid);
        const opp = state.gameOver.results.find((r) => r.pid !== myPid);
        if (me) {
          if (me.won) sounds.play("victory");
          else if (!opp?.won) sounds.play("draw");
          else sounds.play("defeat");
        }
      }

      // ---- Abilities ----
      if (!prev.abilityEffect && state.abilityEffect) sounds.play("ability");
      if (!prev.abilityToast && state.abilityToast) sounds.play("abilityOpponent");

      // ---- Lobby joins / leaves ----
      if (state.roomState && prev.roomState) {
        const nowIds = new Set(state.roomState.players.map((p) => p.pid));
        const prevIds = new Set(prev.roomState.players.map((p) => p.pid));
        for (const id of nowIds) if (!prevIds.has(id)) sounds.play("join");
        for (const id of prevIds) if (!nowIds.has(id)) sounds.play("leave");
      }

      // ---- Abandoned / errors ----
      if (!prev.abandoned && state.abandoned) sounds.play("abandon");
      if (!prev.authError && state.authError) sounds.play("error");
    });
    return unsub;
  }, []);

  // ---- Global soft click for interactive elements ----
  useEffect(() => {
    const onClick = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("[data-no-sound]")) return;
      if (target.closest('button, [role="button"], a[href], input[type="checkbox"], input[type="radio"]')) {
        sounds.play("click");
      }
    };
    document.addEventListener("pointerdown", onClick);
    return () => document.removeEventListener("pointerdown", onClick);
  }, []);

  return null;
}
