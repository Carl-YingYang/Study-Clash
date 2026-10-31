import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { generateQuestions } from "@/lib/ai";
import { QUIZ_DIFFICULTIES, QUESTION_COUNTS, type QuizDifficulty } from "@/lib/characters";

/**
 * POST /api/documents/:id/generate
 * Body: { count: 10|20|30, difficulty: EASY|NORMAL|HARD }
 *
 * Runs the AI question generator against the extracted document text.
 * This can take up to a couple of minutes for 30 questions.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, ownerId: user.id } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  if (doc.status !== "ready") {
    return NextResponse.json(
      {
        error:
          doc.error ??
          "This document does not contain enough usable text to generate a quiz.",
      },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => null);
  const count = Number(body?.count);
  const difficulty = String(body?.difficulty ?? "").toUpperCase() as QuizDifficulty;

  if (!QUESTION_COUNTS.includes(count as 10 | 20 | 30)) {
    return NextResponse.json(
      { error: "Question count must be 10, 20 or 30." },
      { status: 400 }
    );
  }
  if (!QUIZ_DIFFICULTIES.includes(difficulty)) {
    return NextResponse.json(
      { error: "Difficulty must be EASY, NORMAL or HARD." },
      { status: 400 }
    );
  }

  // Prevent overlapping generations for the same document.
  const pending = await db.quiz.findFirst({
    where: { documentId: doc.id, status: "generating" },
  });
  if (pending) {
    return NextResponse.json(
      { error: "A quiz is already being generated from this document. Wait for it to finish." },
      { status: 409 }
    );
  }

  const quiz = await db.quiz.create({
    data: {
      documentId: doc.id,
      questionCount: count,
      difficulty,
      status: "generating",
    },
  });

  let outcome;
  try {
    outcome = await generateQuestions({
      sourceText: doc.extractedText,
      count,
      difficulty,
    });
  } catch (err) {
    console.error("generation error", err);
    await db.quiz.update({
      where: { id: quiz.id },
      data: {
        status: "failed",
        error: "The AI generator crashed while writing questions. Please try again.",
      },
    });
    return NextResponse.json(
      { error: "The AI generator crashed while writing questions. Please try again." },
      { status: 502 }
    );
  }

  if (outcome.error || outcome.questions.length < count) {
    const message =
      outcome.error ??
      "The material did not support enough reliable questions. Try a lower question count or richer material.";
    await db.quiz.update({
      where: { id: quiz.id },
      data: { status: "insufficient", error: message },
    });
    return NextResponse.json(
      {
        error: message,
        generatedCount: outcome.questions.length,
      },
      { status: 422 }
    );
  }

  await db.question.createMany({
    data: outcome.questions.map((q, i) => ({
      quizId: quiz.id,
      order: i,
      text: q.text,
      choices: JSON.stringify(q.choices),
      correctIndex: q.correctIndex, // stored server-side; never serialized to clients mid-game
      explanation: q.explanation,
      sourceRef: q.sourceRef,
      difficulty,
    })),
  });

  const ready = await db.quiz.update({
    where: { id: quiz.id },
    data: { status: "ready", error: null },
  });

  return NextResponse.json({
    quiz: {
      id: ready.id,
      documentId: doc.id,
      documentName: doc.fileName,
      questionCount: ready.questionCount,
      difficulty: ready.difficulty,
      status: ready.status,
      error: null,
      createdAt: ready.createdAt.toISOString(),
    },
  });
}
