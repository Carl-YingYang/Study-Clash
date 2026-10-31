// STUDY CLASH — server-side document text extraction (PDF / DOCX / PPTX)
// Raw files are only ever handled here (server side). Extracted text is stored
// in the database; clients only ever receive previews of their OWN documents.

export type SupportedFileType = "pdf" | "docx" | "pptx";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const EXTENSION_MAP: Record<string, SupportedFileType> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
};

export function detectFileType(fileName: string): SupportedFileType | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MAP[ext] ?? null;
}

export interface ExtractionResult {
  text: string;
  pages: number;
}

/** Normalize whitespace while preserving paragraph structure. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse v2 (ESM class API, Node-safe build of pdf.js under the hood).
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text ?? "", pages: result.total ?? 0 };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return { text: value ?? "", pages: 0 };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles: { n: number; path: string }[] = [];
  zip.forEach((path, file) => {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
    if (match && !file.dir) {
      slideFiles.push({ n: parseInt(match[1], 10), path });
    }
  });
  slideFiles.sort((a, b) => a.n - b.n);
  // Also collect slide notes for extra context
  const noteFiles: { n: number; path: string }[] = [];
  zip.forEach((path, file) => {
    const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(path);
    if (match && !file.dir) {
      noteFiles.push({ n: parseInt(match[1], 10), path });
    }
  });
  noteFiles.sort((a, b) => a.n - b.n);

  const parts: string[] = [];
  for (const slide of slideFiles) {
    const xml = await zip.file(slide.path)?.async("string");
    if (!xml) continue;
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1])
    );
    const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
    if (slideText) parts.push(`[Slide ${slide.n}] ${slideText}`);
  }
  for (const note of noteFiles) {
    const xml = await zip.file(note.path)?.async("string");
    if (!xml) continue;
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1])
    );
    const noteText = runs.join(" ").replace(/\s+/g, " ").trim();
    if (noteText) parts.push(`[Notes ${note.n}] ${noteText}`);
  }
  return { text: parts.join("\n\n"), pages: slideFiles.length };
}

export async function extractDocumentText(
  buffer: Buffer,
  fileType: SupportedFileType
): Promise<ExtractionResult> {
  let result: ExtractionResult;
  if (fileType === "pdf") result = await extractPdf(buffer);
  else if (fileType === "docx") result = await extractDocx(buffer);
  else result = await extractPptx(buffer);

  const text = normalizeText(result.text).slice(0, 300_000); // sanity cap
  return { text, pages: result.pages };
}
