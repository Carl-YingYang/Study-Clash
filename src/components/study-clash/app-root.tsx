"use client";

// Study Clash application root — single-page app shell (the sandbox exposes
// only the / route; all navigation is client-side view switching).
import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouterStore, useGameStore, type View } from "./stores";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useSoundPrefs } from "@/lib/sounds";
import { SoundDirector } from "./sound-director";
import {
  LayoutDashboard,
  FolderOpen,
  Swords,
  Bot,
  Trophy,
  User,
  Settings,
  LogOut,
  Loader2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";

import LandingView from "./views/landing";
import AuthView from "./views/auth";
import DashboardView from "./views/dashboard";
import LibraryView from "./views/library";
import ClashSetupView from "./views/clash-setup";
import PracticeSetupView from "./views/practice-setup";
import LobbyView from "./views/lobby";
import GameView from "./views/game";
import ResultsView from "./views/results";
import LeaderboardView from "./views/leaderboard";
import ProfileView from "./views/profile";
import SettingsView from "./views/settings";

const NAV_ITEMS: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "library", label: "Library", icon: FolderOpen },
  { view: "clash", label: "Clash", icon: Swords },
  { view: "practice", label: "Practice", icon: Bot },
  { view: "leaderboard", label: "Ranks", icon: Trophy },
  { view: "profile", label: "Profile", icon: User },
  { view: "settings", label: "Settings", icon: Settings },
];

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 shrink-0"
      aria-label="Study Clash home"
    >
      <img src="/sc-logo.svg" alt="" className="size-8 sm:size-9 rounded-lg border-2 border-ink" />
      <span className="font-display font-bold text-xl tracking-tight uppercase leading-none max-[420px]:hidden">
        Study<span className="text-brand">Clash</span>
      </span>
    </button>
  );
}

function AppFooter() {
  return (
    <footer className="mt-auto bg-ink text-paper border-t-2 border-ink">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <img src="/sc-logo.svg" alt="" className="size-7 rounded-md" />
          <div>
            <p className="font-display font-bold text-sm uppercase tracking-wide">
              Study Clash
            </p>
            <p className="text-xs text-paper/70">
              Upload your lessons. Challenge your friends. Prove who&apos;s actually built different.
            </p>
          </div>
        </div>
        <p className="text-xs text-paper/60">
          AI-generated quizzes · Real-time clashes · Practice bots
        </p>
      </div>
    </footer>
  );
}

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        { }
        <img src="/sc-logo.svg" alt="Study Clash" className="size-16 rounded-xl border-2 border-ink shadow-nb" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="font-bold text-sm uppercase tracking-widest">Loading arena</span>
        </div>
      </div>
    </div>
  );
}

export default function AppRoot() {
  const { data: session, status } = useSession();
  const view = useRouterStore((s) => s.view);
  const params = useRouterStore((s) => s.params);
  const go = useRouterStore((s) => s.go);
  const gameSocketConnected = useGameStore((s) => s.connected);
  const { toast } = useToast();
  const sound = useSoundPrefs();

  // Global custom-event toasts driven by the game store.
  useEffect(() => {
    const onError = (e: Event) =>
      toast({ title: "Rejected", description: (e as CustomEvent<string>).detail, variant: "destructive" });
    const onAbandoned = (e: Event) => {
      toast({
        title: "Match abandoned",
        description: (e as CustomEvent<string>).detail,
        variant: "destructive",
      });
      go("dashboard");
    };
    const onAbility = (e: Event) =>
      toast({ title: "Ability used", description: (e as CustomEvent<string>).detail });
    window.addEventListener("sc:error", onError);
    window.addEventListener("sc:abandoned", onAbandoned);
    window.addEventListener("sc:ability-used", onAbility);
    return () => {
      window.removeEventListener("sc:error", onError);
      window.removeEventListener("sc:abandoned", onAbandoned);
      window.removeEventListener("sc:ability-used", onAbility);
    };
  }, [toast, go]);

  // Handle ?join=CODE invitation links (before and after authentication).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const joinCode = new URLSearchParams(window.location.search).get("join");
    if (!joinCode) return;
    window.history.replaceState({}, "", "/");
    if (status === "authenticated") {
      go("clash", { joinCode: joinCode.toUpperCase() });
    } else if (status === "unauthenticated") {
      go("auth", { joinCode: joinCode.toUpperCase(), intent: "join" });
    }
  }, [status, go]);

  // Cleanup any live socket when the user signs out.
  useEffect(() => {
    if (status === "unauthenticated") {
      useGameStore.getState().disconnect();
    }
  }, [status]);

  // Follow the match phase: lobby → game when the match starts, back to
  // lobby on rematch, and to results when it ends.
  const phase = useGameStore((s) => s.roomState?.phase);
  useEffect(() => {
    if (!phase) return;
    if ((phase === "countdown" || phase === "question" || phase === "reveal") && view === "lobby") {
      go("game");
    } else if (phase === "lobby" && (view === "game" || view === "results")) {
      go("lobby");
    }
  }, [phase, view, go]);

  if (status === "loading") return <Splash />;

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        {view === "auth" ? <AuthView /> : <LandingView />}
        <AppFooter />
      </div>
    );
  }

  const focused = view === "lobby" || view === "game" || view === "results";
  const username = session?.user?.name ?? "player";

  const renderView = () => {
    switch (view) {
      case "dashboard":
        return <DashboardView />;
      case "library":
        return <LibraryView />;
      case "clash":
        return <ClashSetupView />;
      case "practice":
        return <PracticeSetupView />;
      case "lobby":
        return <LobbyView />;
      case "game":
        return <GameView />;
      case "results":
        return <ResultsView />;
      case "leaderboard":
        return <LeaderboardView />;
      case "profile":
        return <ProfileView />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SoundDirector />
      <header className="sticky top-0 z-40 bg-card border-b-2 border-ink">
        <div className="mx-auto max-w-6xl px-3 sm:px-6 h-16 flex items-center gap-2 sm:gap-3">
          <Logo onClick={() => go("dashboard")} />
          <nav
            className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-none py-1 min-w-0"
            aria-label="Main navigation"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => go(item.view)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap border-2 transition-colors shrink-0",
                    active
                      ? "bg-ink text-paper border-ink"
                      : "border-transparent text-foreground/70 hover:bg-accent hover:border-ink"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {gameSocketConnected && (
              <span className="nb-chip bg-mint text-ink hidden sm:inline-flex" title="Live match connected">
                <span className="size-2 rounded-full bg-ink inline-block" />
                Live
              </span>
            )}
            <span className="nb-chip bg-lav text-ink hidden md:inline-flex">
              @{username}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={sound.toggleMuted}
              aria-label={sound.muted ? "Unmute sound effects" : "Mute sound effects"}
              title={sound.muted ? "Sound: off" : "Sound: on"}
            >
              {sound.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void signOut({ callbackUrl: "/" })}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className={cn("flex-1 w-full", focused ? "" : "mx-auto max-w-6xl px-4 sm:px-6 py-6")}>
        {renderView()}
      </main>

      {view !== "game" && <AppFooter />}
      {view === "game" && (
        <div className="h-2 bg-ink" aria-hidden />
      )}
    </div>
  );
}
