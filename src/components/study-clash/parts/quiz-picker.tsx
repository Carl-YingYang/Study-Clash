"use client";

// Quiz picker used by Clash & Practice setup: lists the caller's ready quizzes.
import { useDocuments } from "../hooks";
import { useRouterStore } from "../stores";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen, CircleAlert } from "lucide-react";
import type { QuizSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function QuizPicker({
  value,
  onChange,
}: {
  value: QuizSummary | null;
  onChange: (quiz: QuizSummary | null) => void;
}) {
  const { documents, loading, error } = useDocuments();
  const go = useRouterStore((s) => s.go);
  const quizzes = (documents ?? []).flatMap((d) => d.quizzes.filter((q) => q.status === "ready"));

  if (loading) {
    return (
      <div className="nb-card p-6 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Loading your quizzes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="nb-card p-6 flex items-center gap-3 bg-coral">
        <CircleAlert className="size-5" /> {error}
      </div>
    );
  }

  if (quizzes.length === 0) {
    return (
      <div className="nb-card p-8 text-center">
        <p className="font-display font-bold text-lg uppercase">No quizzes yet</p>
        <p className="text-sm text-muted-foreground font-medium mt-1">
          Upload a document and let the AI generate a quiz first.
        </p>
        <Button className="mt-4" onClick={() => go("library")}>
          <FolderOpen className="size-4" /> Open library
        </Button>
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label="Choose a quiz" className="flex flex-col gap-2 max-h-72 overflow-y-auto scrollbar-nb pr-1">
      {quizzes.map((quiz) => {
        const active = value?.id === quiz.id;
        return (
          <button
            key={quiz.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(quiz)}
            className={cn(
              "nb-press flex items-center gap-3 border-2 border-ink rounded-lg px-4 py-3 text-left",
              active ? "bg-ink text-paper shadow-nb" : "bg-card shadow-nb-sm"
            )}
          >
            <div className="min-w-0 flex-1">
              <p className={cn("font-bold text-sm truncate", active ? "text-paper" : "text-foreground")} title={quiz.documentName}>
                {quiz.documentName}
              </p>
              <p className={cn("text-xs font-medium truncate", active ? "text-paper/70" : "text-muted-foreground")}>
                Generated {new Date(quiz.createdAt).toLocaleDateString()}
              </p>
            </div>
            <Badge variant={active ? "mint" : quiz.difficulty === "HARD" ? "destructive" : quiz.difficulty === "NORMAL" ? "secondary" : "mint"}>
              {quiz.difficulty}
            </Badge>
            <span className={cn("font-display font-bold text-sm whitespace-nowrap", active ? "text-mint" : "text-foreground")}>
              {quiz.questionCount} items
            </span>
          </button>
        );
      })}
    </div>
  );
}
