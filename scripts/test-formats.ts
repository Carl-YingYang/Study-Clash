// Verifies PDF and PPTX extraction paths with crafted real files.
import JSZip from "jszip";

const WEB = "http://localhost:3000";
let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string, extra = "") {
  checks++;
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ FAIL: ${label} ${extra}`);
  }
}

const cookies = new Map<string, string>();
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(WEB + path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  for (const sc of (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return res;
}

// ---- minimal but valid PDF with several text lines ----
function buildPdf(lines: string[]): Blob {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = lines
    .map((l, i) => `BT /F1 11 Tf 50 ${760 - i * 16} Td (${esc(l)}) Tj ET`)
    .join("\n");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Blob([new Uint8Array(Buffer.from(pdf, "latin1"))], { type: "application/pdf" });
}

async function buildPptx(slides: string[][]): Promise<Blob> {
  const zip = new JSZip();
  const n = slides.length;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${Array.from(
      { length: n },
      (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    ).join("")}</Types>`
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from(
      { length: n },
      (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    ).join("")}</Relationships>`
  );
  slides.forEach((runs, i) => {
    const shapes = runs
      .map((t, j) => {
        const y = j * 60;
        return `<p:sp><p:nvSpPr><p:cNvPr id="${j + 2}" name="T${j}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="100" y="${y}"/><a:ext cx="5000000" cy="50000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
      })
      .join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>${shapes}</p:spTree></p:cSld></p:sld>`
    );
  });
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

async function main() {
  const stamp = Date.now().toString(36).slice(-6);
  const user = `fmt_${stamp}`;
  await req("/api/auth/register", { method: "POST", body: JSON.stringify({ username: user, password: "study123" }) });
  const { csrfToken } = await (await req("/api/auth/csrf")).json();
  await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username: user, password: "study123", callbackUrl: "/", json: "true" }).toString(),
  });

  console.log("=== PDF extraction ===");
  const pdfBlob = buildPdf([
    "The mitochondrion is the powerhouse of the cell and produces ATP through cellular respiration.",
    "Mitochondria have two membranes: an outer membrane and a folded inner membrane called the cristae.",
    "The Krebs cycle occurs in the mitochondrial matrix and oxidizes acetyl-CoA to carbon dioxide.",
    "The electron transport chain sits on the inner membrane and drives ATP synthase through a proton gradient.",
    "Glycolysis happens in the cytoplasm and splits glucose into two molecules of pyruvate.",
    "Mitochondria carry their own circular DNA and are inherited maternally in most organisms.",
    "Oxidative phosphorylation is the final stage of cellular respiration and requires oxygen as the final electron acceptor.",
    "The intermembrane space stores protons pumped by the electron transport chain, creating the proton motive force.",
  ]);
  const pdfForm = new FormData();
  pdfForm.append("file", pdfBlob, "cell-biology.pdf");
  const pdfRes = await req("/api/documents", { method: "POST", body: pdfForm });
  const pdfData = await pdfRes.json();
  ok(pdfRes.status === 200 && pdfData.document?.status === "ready", "PDF uploaded & extracted", JSON.stringify(pdfData).slice(0, 300));
  ok((pdfData.document?.textChars ?? 0) > 400, `PDF text: ${pdfData.document?.textChars} chars, ${pdfData.document?.pageCount} page(s)`);

  console.log("=== PPTX extraction ===");
  const pptxBlob = await buildPptx([
    [
      "World War II: Overview",
      "World War II lasted from 1939 to 1945 and involved more than thirty countries across the globe.",
      "The war is generally considered the deadliest conflict in human history, with over seventy million fatalities.",
      "The principal belligerents were the Allied powers, including Britain, the Soviet Union and the United States, and the Axis powers, led by Germany, Italy and Japan.",
    ],
    [
      "Key turning points",
      "The Battle of Stalingrad, fought between August 1942 and February 1943, marked the first major defeat of Nazi Germany on the eastern front.",
      "D-Day, the Normandy landings on June 6 1944, opened the western front in Europe and began the liberation of France.",
      "The attack on Pearl Harbor in December 1941 brought the United States into the war against the Axis powers.",
      "Midway, fought in June 1942, is regarded as the turning point of the Pacific naval war in favor of the Allies.",
    ],
    [
      "Aftermath",
      "The war in Europe ended with the unconditional surrender of Germany in May 1945, followed by Japan's surrender in September 1945 after the atomic bombings.",
      "The United Nations was founded in October 1945 to prevent future global conflicts and promote international cooperation.",
      "The war led to the Cold War, a decades-long geopolitical rivalry between the United States and the Soviet Union.",
      "The Marshall Plan rebuilt Western European economies and established the framework for modern Atlantic cooperation.",
    ],
  ]);
  const pptxForm = new FormData();
  pptxForm.append("file", pptxBlob, "history-deck.pptx");
  const pptxRes = await req("/api/documents", { method: "POST", body: pptxForm });
  const pptxData = await pptxRes.json();
  ok(pptxRes.status === 200 && pptxData.document?.status === "ready", "PPTX uploaded & extracted", JSON.stringify(pptxData).slice(0, 300));
  ok((pptxData.document?.textChars ?? 0) > 300, `PPTX text: ${pptxData.document?.textChars} chars, ${pptxData.document?.pageCount} slides`);

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED" ` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("crashed", e);
  process.exit(1);
});
