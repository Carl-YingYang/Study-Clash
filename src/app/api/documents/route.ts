import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { detectFileType, extractDocumentText, MAX_UPLOAD_BYTES } from "@/lib/extraction";

function formatDoc(d: {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  status: string;
  textChars: number;
  pageCount: number;
  error: string | null;
  createdAt: Date;
  quizzes: Array<{
    id: string;
    documentId: string;
    questionCount: number;
    difficulty: string;
    status: string;
    error: string | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: d.id,
    fileName: d.fileName,
    fileSize: d.fileSize,
    fileType: d.fileType as "pdf" | "docx" | "pptx",
    status: d.status as "processing" | "ready" | "failed" | "insufficient",
    textChars: d.textChars,
    pageCount: d.pageCount,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    quizzes: d.quizzes.map((q) => ({
      id: q.id,
      documentId: q.documentId,
      documentName: d.fileName,
      questionCount: q.questionCount,
      difficulty: q.difficulty as "EASY" | "NORMAL" | "HARD",
      status: q.status as "generating" | "ready" | "failed" | "insufficient",
      error: q.error,
      createdAt: q.createdAt.toISOString(),
    })),
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docs = await db.document.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
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

  return NextResponse.json({ documents: docs.map(formatDoc) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "The file is empty." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File is too large. Maximum size is 20 MB." },
        { status: 413 }
      );
    }
    const fileType = detectFileType(file.name);
    if (!fileType) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, DOCX or PPTX file." },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";
    let pages = 0;
    let status = "ready";
    let error: string | null = null;

    try {
      const extracted = await extractDocumentText(buffer, fileType);
      text = extracted.text;
      pages = extracted.pages;
      if (text.trim().length < 600) {
        status = "insufficient";
        error =
          "Very little text could be extracted (this may be a scanned or image-based file). A richer text document is needed to generate quizzes.";
      }
    } catch (err) {
      console.error("extraction error", err);
      status = "failed";
      error = "Text extraction failed. The file may be corrupted or password-protected.";
    }

    const doc = await db.document.create({
      data: {
        ownerId: user.id,
        fileName: file.name.slice(0, 200),
        fileSize: file.size,
        fileType,
        status,
        extractedText: text,
        textChars: text.length,
        pageCount: pages,
        error,
      },
    });

    return NextResponse.json({ document: { ...formatDoc({ ...doc, quizzes: [] }) } });
  } catch (err) {
    console.error("upload error", err);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }
}
