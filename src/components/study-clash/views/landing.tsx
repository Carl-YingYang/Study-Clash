
"use client";

import { useRouterStore } from "../stores";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";
import {
  FileUp,
  BrainCircuit,
  Swords,
  Bot,
  Sparkles,
  Trophy,
  ArrowRight,
  Timer,
  ShieldCheck,
} from "lucide-react";
import { CHARACTERS } from "@/lib/characters";

const CharacterStage = dynamic(
  () => import("../parts/character-stage"),
  {
    ssr: false,
    loading: () => (
      <div className="h-56 w-full sm:h-72 lg:h-80" />
    ),
  }
);

const FEATURES = [
  {
    icon: BrainCircuit,
    title: "AI question generation",
    body: "Upload a PDF, DOCX or PPTX. The AI reads your material and writes grounded multiple-choice questions — with three difficulty levels that actually change the questions.",
    accent: "bg-lav",
  },
  {
    icon: Swords,
    title: "Clash Mode",
    body: "Create a room, share the code, and face a friend in real time. Same questions, same timer, server-authoritative scoring. No peeking at the answer key — for anyone.",
    accent: "bg-coral",
  },
  {
    icon: Bot,
    title: "Practice vs AI",
    body: "No friend online? Four bot levels — Easy, Mid, Hard and Genius — answer the same questions through the same scoring pipeline, with realistic reaction times.",
    accent: "bg-mint",
  },
  {
    icon: Sparkles,
    title: "Characters with abilities",
    body: "Pick a 3D figurine with a once-per-match strategic ability: eliminate wrong answers, buy time, or stack bonus points. Balanced. Never an instant win.",
    accent: "bg-lav",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Upload your material",
    body: "Lecture notes, slide decks, reviewers — PDF, DOCX or PPTX up to 20 MB.",
  },
  {
    n: "02",
    title: "Generate a quiz",
    body: "Choose 10, 20 or 30 items at Easy, Normal or Hard difficulty.",
  },
  {
    n: "03",
    title: "Pick your fighter",
    body: "Choose a character and its once-per-match ability.",
  },
  {
    n: "04",
    title: "Clash or practice",
    body: "Challenge a friend with a room code, or battle an AI bot solo.",
  },
];

export default function LandingView() {
  const go = useRouterStore((s) => s.go);

  return (
    <div className="flex-1 min-w-0 w-full overflow-x-hidden">

      {/* Hero */}
      <section className="nb-grid-bg border-b-2 border-ink overflow-hidden">
        <div
          className="
            mx-auto w-full max-w-6xl
            px-4 sm:px-6
            py-10 sm:py-16 lg:py-20
            grid grid-cols-1
            lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]
            gap-10 lg:gap-8 xl:gap-12
            items-center
            min-w-0
          "
        >

          {/* LEFT: Hero text */}
          <div className="flex flex-col items-start gap-5 sm:gap-6 min-w-0 w-full">
            <Badge variant="mint" className="text-xs">
              <Sparkles className="size-3" />
              AI-powered competitive studying
            </Badge>

            <h1
              className="
                w-full max-w-[16ch]
                font-display font-bold
                text-[2.5rem] leading-[1.04]
                sm:text-5xl xl:text-6xl
                tracking-tight
                break-words
              "
            >
              Upload your lessons.
              <br />

              <span
                className="
                  inline-block
                  bg-brand text-paper
                  px-3 py-0.5
                  border-2 border-ink
                  rounded-lg shadow-nb
                  -rotate-1
                  max-w-full
                "
              >
                Challenge
              </span>{" "}
              your friends.
              <br />

              Prove who&apos;s actually{" "}

              <span
                className="
                  inline-block
                  bg-coral text-ink
                  px-3 py-0.5
                  border-2 border-ink
                  rounded-lg shadow-nb
                  rotate-1
                  max-w-full
                "
              >
                built different.
              </span>
            </h1>

            <p className="w-full max-w-xl text-sm sm:text-base lg:text-lg text-muted-foreground font-medium leading-relaxed">
              Study Clash turns your own study materials into fast, timed,
              multiplayer quizzes. Kahoot-style competition — generated from
              your documents, scored by the server, and ranked by division.
            </p>

            <div className="flex flex-wrap gap-3 w-full">
              <Button
                size="xl"
                onClick={() => go("auth")}
                className="w-full sm:w-auto"
              >
                Create free account
                <ArrowRight className="size-5" />
              </Button>

              <Button
                size="xl"
                variant="outline"
                onClick={() => go("auth")}
                className="w-full sm:w-auto"
              >
                I already have one
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 pt-1 w-full">
              <span className="nb-chip bg-card">
                <FileUp className="size-3" />
                PDF · DOCX · PPTX
              </span>

              <span className="nb-chip bg-card">
                <Timer className="size-3" />
                10 / 15 / 20s timers
              </span>

              <span className="nb-chip bg-card">
                <ShieldCheck className="size-3" />
                Server-side scoring
              </span>

              <span className="nb-chip bg-card">
                <Trophy className="size-3" />
                10 / 20 / 30 item divisions
              </span>
            </div>
          </div>

          {/* RIGHT: Character showcase */}
          <div className="relative w-full min-w-0 max-w-2xl mx-auto lg:mx-0 lg:max-w-none">

            {/* Decorative backing panel */}
            <div
              aria-hidden="true"
              className="
                absolute
                inset-x-5 sm:inset-x-8
                top-5 bottom-5
                bg-lav
                border-2 border-ink
                rounded-2xl
                shadow-nb-lg
                -rotate-2
                pointer-events-none
              "
            />

            {/* Main character card */}
            <div
              className="
                relative z-10
                w-full min-w-0 max-w-full
                bg-card
                border-2 border-ink
                rounded-2xl
                shadow-nb
                p-2 sm:p-3
                rotate-0 sm:rotate-1
                overflow-hidden
              "
            >

              {/* 3D models */}
              <div className="w-full min-w-0 max-w-full overflow-hidden">
                <CharacterStage
                  characters={CHARACTERS.map((c) => ({
                    id: c.id,
                  }))}
                  className="h-56 w-full max-w-full sm:h-72 lg:h-80"
                  cameraZ={3.1}
                />
              </div>

              {/* Character labels */}
              <div className="grid grid-cols-5 gap-1 pb-1 w-full min-w-0">
                {CHARACTERS.map((c) => (
                  <span
                    key={c.id}
                    className="
                      min-w-0
                      text-center
                      text-[8px] sm:text-[9px] lg:text-[10px]
                      font-bold uppercase tracking-wide
                      text-muted-foreground
                      px-0.5
                      break-words
                    "
                  >
                    {c.name}
                  </span>
                ))}
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
        <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight mb-2">
          A competitive arena for your brain
        </h2>

        <p className="text-muted-foreground font-medium mb-8 max-w-2xl">
          Not a boring reviewer. Not an LMS. A game that happens to make you
          actually learn the material.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;

            return (
              <div
                key={f.title}
                className="nb-card p-5 nb-press cursor-default"
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`${f.accent} border-2 border-ink rounded-lg p-2.5 shrink-0`}
                  >
                    <Icon
                      className="size-6 text-ink"
                      strokeWidth={2.4}
                    />
                  </span>

                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-lg uppercase tracking-wide mb-1">
                      {f.title}
                    </h3>

                    <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                      {f.body}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-lav/40 border-y-2 border-ink">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight mb-8">
            From notes to showdown in four steps
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s) => (
              <div key={s.n} className="nb-card p-5">
                <span className="font-display font-bold text-3xl text-brand">
                  {s.n}
                </span>

                <h3 className="font-display font-bold text-base uppercase tracking-wide mt-2 mb-1.5">
                  {s.title}
                </h3>

                <p className="text-sm text-muted-foreground font-medium">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
        <div
          className="
            bg-ink text-paper
            border-2 border-ink
            rounded-2xl shadow-nb-brand
            p-8 sm:p-12
            flex flex-col items-center gap-5
            text-center
          "
        >
          <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">
            Your notes are a weapon. Use them.
          </h2>

          <p className="text-paper/75 font-medium max-w-xl">
            Free account. Upload a document. Generate a quiz. Beat your friends
            — or lose to a Genius bot and study harder.
          </p>

          <Button
            size="xl"
            variant="mint"
            onClick={() => go("auth")}
          >
            Start clashing
            <ArrowRight className="size-5" />
          </Button>
        </div>
      </section>

    </div>
  );
}
