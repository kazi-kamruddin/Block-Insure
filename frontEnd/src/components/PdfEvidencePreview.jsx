import { useEffect, useRef, useState } from "react";
import { AnnotationMode, getDocument, GlobalWorkerOptions, version } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_PIXELS = 4_000_000;

// Render pixels and plain text only. Never execute document scripts, forms,
// links, embedded files, or HTML supplied by a medical document.
export default function PdfEvidencePreview({ blob }) {
  const canvas = useRef(null);
  const [document, setDocument] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task;
    async function open() {
      if (blob.size > MAX_BYTES) throw new Error("This PDF exceeds the 20 MB preview limit. Use Download decrypted.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")) throw new Error("This file is not a valid PDF. Use Download decrypted to inspect it safely.");
      if (cancelled) return;
      task = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true,
        disableFontFace: true, maxImageSize: MAX_PIXELS, stopAtErrors: true });
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PAGES) throw new Error("This PDF exceeds the 100-page preview limit. Use Download decrypted.");
      if (!cancelled) setDocument(pdf);
    }
    open().catch((failure) => { if (!cancelled) setError(failure.message || "PDF preview unavailable. Use Download decrypted."); });
    return () => { cancelled = true; task?.destroy(); };
  }, [blob]);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    let render;
    async function draw() {
      setRendered(false);
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, Math.sqrt(MAX_PIXELS / (natural.width * natural.height)));
      const viewport = page.getViewport({ scale });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, canvasContext: target.getContext("2d"), viewport, annotationMode: AnnotationMode.DISABLE });
      await render.promise;
      const content = await page.getTextContent();
      if (!cancelled) { setText(content.items.map((item) => item.str || "").join(" ")); setRendered(true); }
    }
    draw().catch((failure) => { if (!cancelled) setError(failure.message || "PDF page could not be rendered. Use Download decrypted."); });
    return () => { cancelled = true; render?.cancel(); };
  }, [document, pageNumber]);

  if (error) return <p role="alert">{error}</p>;
  return <section aria-label="Evidence PDF" data-pdfjs-version={version}>
    <p role="status">{rendered ? `Page ${pageNumber} of ${document.numPages}` : "Rendering PDF…"}</p>
    <div className="flex flex-wrap gap-3 my-3">
      <button type="button" disabled={!rendered || pageNumber === 1} onClick={() => setPageNumber((page) => page - 1)}>Previous PDF page</button>
      <button type="button" disabled={!rendered || pageNumber === document?.numPages} onClick={() => setPageNumber((page) => page + 1)}>Next PDF page</button>
    </div>
    <canvas ref={canvas} aria-label={`Decrypted PDF page ${pageNumber}`} role="img" className="max-w-full h-auto bg-white" />
    {text && <details><summary>Accessible PDF text</summary><p className="whitespace-pre-wrap break-words">{text}</p></details>}
  </section>;
}
