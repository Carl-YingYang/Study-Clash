import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

const PREVIEW_CHARS = 4000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, ownerId: user.id },
    include: {
      quizzes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          documentId: true,
          questionCount: true,
          difficulty: true,
          status: true,
          error: true,
          createdAt: true,
        },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  return NextResponse.json({
    document: {
      id: doc.id,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      fileType: doc.fileType,
      status: doc.status,
      textChars: doc.textChars,
      pageCount: doc.pageCount,
      error: doc.error,
      createdAt: doc.createdAt.toISOString(),
      quizzes: doc.quizzes.map((q) => ({
        id: q.id,
        documentId: q.documentId,
        documentName: doc.fileName,
        questionCount: q.questionCount,
        difficulty: q.difficulty,
        status: q.status,
        error: q.error,
        createdAt: q.createdAt.toISOString(),
      })),
    },
    preview: doc.extractedText.slice(0, PREVIEW_CHARS),
    previewTruncated: doc.extractedText.length > PREVIEW_CHARS,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, ownerId: user.id } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  // Refuse deletion while a room is actively using one of its quizzes.
  const activeRoom = await db.gameRoom.findFirst({
    where: {
      quiz: { documentId: id },
      status: { in: ["lobby", "playing"] },
    },
  });
  if (activeRoom) {
    return NextResponse.json(
      { error: "This document is used by a match that is still in progress." },
      { status: 409 }
    );
  }

  await db.document.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
