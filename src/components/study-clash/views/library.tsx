"use client";

import { useCallback, useRef, useState } from "react";
import { useRouterStore } from "../stores";
import { useDocuments, uploadDocument } from "../hooks";
import { api, formatBytes } from "../api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OptionGroup } from "../parts/option-selector";
import { useToast } from "@/hooks/use-toast";
import type { DocumentSummary, QuizSummary } from "@/lib/types";
import { QUESTION_COUNTS, QUIZ_DIFFICULTIES } from "@/lib/characters";
import {
  FileUp,
  FileText,
  Presentation,
  FileType2,
  Loader2,
  Trash2,
  Sparkles,
  Eye,
  Swords,
  Bot,
  CircleAlert,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  docx: FileType2,
  pptx: Presentation,
};

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  const startUpload = useCallback(
    async (file: File) => {
      if (progress !== null || processing) return;
      setProgress(0);
      try {
        const doc = await uploadDocument(file, setProgress);
        setProcessing(true);
        // Server already extracted text by the time the response arrives;
        // give the UI a beat to show the finished state.
        setTimeout(() => setProcessing(false), 400);
        setProgress(null);
        if (doc.status === "ready") {
          toast({
            title: "Document ready",
            description: `${doc.fileName} — ${doc.textChars.toLocaleString()} characters extracted.`,
          });
        } else {
          toast({
            title: "Document uploaded, but…",
            description: doc.error ?? "Very little text could be extracted.",
            variant: "destructive",
          });
        }
        onUploaded();
      } catch (err) {
        setProgress(null);
        setProcessing(false);
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      }
    },
    [progress, processing, toast, onUploaded]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a document"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void startUpload(file);
      }}
      className={cn(
        "nb-card p-6 border-dashed cursor-pointer flex flex-col items-center gap-3 text-center transition-transform",
        dragging && "bg-lav scale-[1.01]",
        progress !== null && "cursor-progress"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.pptx"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void startUpload(file);
          e.target.value = "";
        }}
      />
      <span className="bg-brand text-paper border-2 border-ink rounded-xl p-3 shadow-nb-sm">
        {progress !== null || processing ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <FileUp className="size-6" />
        )}
      </span>
      {progress !== null ? (
        <div className="w-full max-w-sm flex flex-col gap-2">
          <p className="font-bold text-sm">Uploading {progress}%</p>
          <Progress value={progress} className="h-3 border-2 border-ink rounded-md" />
        </div>
      ) : processing ? (
        <p className="font-bold text-sm text-muted-foreground">Extracting text…</p>
      ) : (
        <>
          <p className="font-display font-bold text-lg uppercase tracking-wide">
            Drop your study material here
          </p>
          <p className="text-sm text-muted-foreground font-medium">
            PDF, DOCX or PPTX · up to 20 MB · text is extracted on the server
          </p>
        </>
      )}
    </div>
  );
}

function QuizRow({
  quiz,
  docName,
  onPlayClash,
  onPlayPractice,
}: {
  quiz: QuizSummary;
  docName: string;
  onPlayClash: (quiz: QuizSummary) => void;
  onPlayPractice: (quiz: QuizSummary) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap border-2 border-ink/15 rounded-lg px-3 py-2 bg-muted/50">
      <Badge variant={quiz.difficulty === "HARD" ? "destructive" : quiz.difficulty === "NORMAL" ? "secondary" : "mint"}>
        {quiz.difficulty}
      </Badge>
      <span className="text-sm font-bold">
        {quiz.questionCount} items
      </span>
      {quiz.status !== "ready" && (
        <Badge variant="outline" className="text-muted-foreground">
          {quiz.status}
        </Badge>
      )}
      {quiz.error && (
        <p className="text-xs text-coral font-medium flex-1 min-w-[140px] truncate" title={quiz.error}>
          {quiz.error}
        </p>
      )}
      <span className="sr-only">From {docName}</span>
      {quiz.status === "ready" && (
        <div className="flex gap-1.5 ml-auto">
          <Button size="sm" variant="ink" onClick={() => onPlayClash(quiz)}>
            <Swords className="size-3.5" /> Clash
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onPlayPractice(quiz)}>
            <Bot className="size-3.5" /> Practice
          </Button>
        </div>
      )}
    </div>
  );
}

export default function LibraryView() {
  const go = useRouterStore((s) => s.go);
  const { documents, loading, error, refresh, setDocuments } = useDocuments();
  const { toast } = useToast();

  const [generateDoc, setGenerateDoc] = useState<DocumentSummary | null>(null);
  const [genCount, setGenCount] = useState<number>(10);
  const [genDifficulty, setGenDifficulty] = useState<string>("NORMAL");
  const [generating, setGenerating] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ doc: DocumentSummary; text: string; truncated: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleGenerate() {
    if (!generateDoc || generating) return;
    setGenerating(true);
    try {
      await api(`/api/documents/${generateDoc.id}/generate`, {
        method: "POST",
        body: JSON.stringify({ count: genCount, difficulty: genDifficulty }),
      });
      toast({
        title: "Quiz ready",
        description: `${genCount} ${genDifficulty} questions generated from ${generateDoc.fileName}.`,
      });
      setGenerateDoc(null);
      void refresh();
    } catch (err) {
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(doc: DocumentSummary) {
    if (deleting) return;
    setDeleting(doc.id);
    try {
      await api(`/api/documents/${doc.id}`, { method: "DELETE" });
      setDocuments((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : prev));
      toast({ title: "Document deleted", description: doc.fileName });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  async function openPreview(doc: DocumentSummary) {
    try {
      const data = await api<{ document: DocumentSummary; preview: string; previewTruncated: boolean }>(
        `/api/documents/${doc.id}`
      );
      setPreviewDoc({ doc: data.document, text: data.preview, truncated: data.previewTruncated });
    } catch (err) {
      toast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  const playClash = (quiz: QuizSummary) => go("clash", { quizId: quiz.id });
  const playPractice = (quiz: QuizSummary) => go("practice", { quizId: quiz.id });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Document library</h1>
        <p className="text-muted-foreground font-medium mt-1">
          Your uploaded material and the quizzes generated from it.
        </p>
      </div>

      <UploadZone onUploaded={refresh} />

      {error && (
        <div className="nb-card p-4 bg-coral flex items-center gap-3">
          <CircleAlert className="size-5 shrink-0" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="nb-card p-5 h-48 animate-pulse bg-muted" />
          ))}
        </div>
      ) : documents && documents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {documents.map((doc) => {
            const Icon = TYPE_ICON[doc.fileType] ?? FileText;
            return (
              <div key={doc.id} className="nb-card p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span className="bg-lav border-2 border-ink rounded-lg p-2.5 shrink-0">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold truncate" title={doc.fileName}>
                      {doc.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium">
                      {formatBytes(doc.fileSize)} · {doc.fileType.toUpperCase()}
                      {doc.pageCount > 0 && ` · ${doc.pageCount} pages`} ·{" "}
                      {doc.textChars.toLocaleString()} chars
                    </p>
                  </div>
                  <span
                    className={`nb-chip ${
                      doc.status === "ready" ? "bg-mint" : doc.status === "insufficient" ? "bg-coral" : "bg-muted"
                    }`}
                  >
                    {doc.status === "ready" ? <Check className="size-3" /> : null}
                    {doc.status}
                  </span>
                </div>

                {doc.error && (
                  <p className="text-xs text-coral font-medium leading-snug">{doc.error}</p>
                )}

                <div className="flex flex-col gap-2">
                  {doc.quizzes.length > 0 ? (
                    doc.quizzes.map((quiz) => (
                      <QuizRow
                        key={quiz.id}
                        quiz={quiz}
                        docName={doc.fileName}
                        onPlayClash={playClash}
                        onPlayPractice={playPractice}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground font-medium">
                      No quizzes yet — generate one below.
                    </p>
                  )}
                </div>

                <div className="flex gap-2 mt-auto flex-wrap">
                  <Button
                    variant="default"
                    onClick={() => {
                      setGenCount(10);
                      setGenDifficulty("NORMAL");
                      setGenerateDoc(doc);
                    }}
                    disabled={doc.status !== "ready"}
                    title={doc.status !== "ready" ? "This document has too little text" : "Generate quiz with AI"}
                  >
                    <Sparkles className="size-4" /> Generate quiz
                  </Button>
                  <Button variant="outline" onClick={() => void openPreview(doc)}>
                    <Eye className="size-4" /> Preview
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(doc)}
                    disabled={deleting === doc.id}
                    aria-label={`Delete ${doc.fileName}`}
                    title="Delete document"
                    className="text-coral hover:bg-coral/20 border-2 border-transparent hover:border-ink"
                  >
                    {deleting === doc.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !loading && (
          <div className="nb-card p-10 text-center">
            <p className="font-display font-bold text-xl uppercase">Library empty</p>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Upload your first PDF, DOCX or PPTX above to get started.
            </p>
          </div>
        )
      )}

      {/* Generate quiz dialog */}
      <Dialog open={!!generateDoc} onOpenChange={(o) => !generating && setGenerateDoc(o ? generateDoc : null)}>
        <DialogContent className="sm:max-w-lg border-2 border-ink shadow-nb-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide flex items-center gap-2">
              <Sparkles className="size-5 text-brand" /> Generate a quiz
            </DialogTitle>
            <DialogDescription className="font-medium">
              The AI writes questions strictly from{" "}
              <span className="font-bold text-foreground">{generateDoc?.fileName}</span>. Answer keys stay
              on the server — nobody sees them during a match.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-2">
            <OptionGroup
              label="Number of questions"
              options={QUESTION_COUNTS.map((n) => ({ value: n, label: `${n} items` }))}
              value={genCount}
              onChange={setGenCount}
              disabled={generating}
            />
            <OptionGroup
              label="Difficulty"
              options={[
                { value: "EASY", label: "Easy", hint: "Definitions & direct facts" },
                { value: "NORMAL", label: "Normal", hint: "Concepts & application" },
                { value: "HARD", label: "Hard", hint: "Scenarios & multi-step reasoning" },
              ]}
              value={genDifficulty}
              onChange={setGenDifficulty}
              accent="bg-lav"
              disabled={generating}
            />
          </div>
          {generating && (
            <div className="flex items-center gap-3 bg-lav/50 border-2 border-ink rounded-lg px-4 py-3">
              <Loader2 className="size-5 animate-spin shrink-0" />
              <p className="text-sm font-bold">
                The AI is writing your questions — this can take up to a minute
                for 30 items. Don&apos;t close this dialog.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGenerateDoc(null)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={() => void handleGenerate()} disabled={generating}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {generating ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="sm:max-w-2xl border-2 border-ink shadow-nb-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide truncate">
              {previewDoc?.doc.fileName}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Extracted text preview{previewDoc?.truncated ? " (first 4,000 characters)" : ""}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-96 border-2 border-ink rounded-lg bg-muted/40 p-4 scrollbar-nb">
            <pre className="whitespace-pre-wrap text-xs font-medium leading-relaxed">
              {previewDoc?.text || "(no text extracted)"}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
