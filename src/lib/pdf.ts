/**
 * In-browser PDF compression.
 *
 * Each page is rendered with pdf.js, re-encoded as a JPEG with MozJPEG (in
 * the same Web Worker as the image tools) and placed on a page of the same
 * size in a new PDF built with pdf-lib. This shrinks scanned documents and
 * photo-heavy PDFs a lot; the trade-off is that text becomes part of the
 * page image and can no longer be selected.
 *
 * Nothing here touches the network except loading pdf.js's own files.
 */
import { compressInWorker, encodeInWorker, TooBigError } from './codec';
import { estimateInitialScale } from './compress';

export class PdfError extends Error {}

export interface PdfPreset {
  dpi: number;
  quality: number;
}

export const PDF_PRESETS = {
  smallest: { dpi: 100, quality: 50 },
  balanced: { dpi: 150, quality: 70 },
  quality: { dpi: 200, quality: 82 },
} satisfies Record<string, PdfPreset>;

export type PdfPresetName = keyof typeof PDF_PRESETS;

export interface CompressPdfOptions {
  /** Hard maximum in bytes; switches to "fit under a size" mode. */
  maxBytes?: number;
  /** Used when maxBytes is not set. */
  preset?: PdfPresetName;
  grayscale?: boolean;
  onProgress?: (page: number, pages: number) => void;
}

export interface CompressPdfResult {
  blob: Blob;
  pages: number;
  /** First page of the result as a JPEG, for the preview. */
  firstPage: Blob | null;
  /** The original was kept because it was already small enough or compressing didn't help. */
  kept: 'already-small' | 'no-gain' | null;
}

// pdf.js renders text and vector pages; a full A4 page at 150 DPI is ~2.2 MP.
const MAX_PAGE_PIXELS = 3_000_000;
const MAX_PAGES = 300;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdf.js and its worker. Called early so tools work offline after page load. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })().catch((e) => {
      pdfjsPromise = null;
      throw e;
    });
  }
  return pdfjsPromise;
}

export async function isPdf(file: File): Promise<boolean> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}

/** Opens a PDF. Call `close()` when done to free pdf.js's memory and worker resources. */
async function openPdf(file: File) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({
    data,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (e) {
    task.destroy();
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new PdfError('This PDF is protected with a password. Remove the password (for example by printing it to a new PDF), then try again.');
    }
    throw new PdfError('This file could not be opened as a PDF. It may be damaged; try downloading it again.');
  }
}

type PdfDoc = Awaited<ReturnType<typeof openPdf>>['doc'];

/**
 * Black and white with a scan-style clean-up: the most common light tone
 * (the paper) becomes pure white, so yellow or grey scans look crisp and
 * compress much better.
 */
function toGrayscale(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = l;
    hist[l]++;
  }
  // Paper tone: the 80th percentile of brightness (most of a document is paper).
  const target = (d.length / 4) * 0.8;
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) {
      paper = v;
      break;
    }
  }
  // Only stretch when the page really is a light document, not a dark photo.
  const k = paper >= 150 && paper < 250 ? 255 / (paper - 6) : 1;
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.min(255, d[i] * k);
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  ctx.putImageData(img, 0, 0);
}

/** Renders one page (1-based) at `dpi`, capped to a sane pixel count. */
async function renderPage(doc: PdfDoc, n: number, dpi: number, grayscale: boolean) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 }); // 1 unit = 1 point = 1/72 inch
  let scale = dpi / 72;
  const px = base.width * base.height * scale * scale;
  if (px > MAX_PAGE_PIXELS) scale *= Math.sqrt(MAX_PAGE_PIXELS / px);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { willReadFrequently: grayscale })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, background: 'white' }).promise;
  if (grayscale) toGrayscale(ctx, canvas.width, canvas.height);
  const bitmap = await createImageBitmap(canvas);
  canvas.width = canvas.height = 0; // release memory early on phones
  page.cleanup();
  return { bitmap, widthPt: base.width, heightPt: base.height };
}

/** A small render of page 1, for showing the original next to the result. */
export async function renderThumbnail(file: File, maxEdge = 600): Promise<{ blob: Blob; pages: number }> {
  const { doc, close } = await openPdf(file);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxEdge / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: ctx, viewport, background: 'white' }).promise;
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('thumb'))), 'image/jpeg', 0.85));
    return { blob, pages: doc.numPages };
  } finally {
    await close();
  }
}

interface PageImage {
  jpeg: Uint8Array;
  widthPt: number;
  heightPt: number;
}

async function buildPdf(pages: PageImage[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  out.setProducer('vectradev.in');
  out.setCreator('vectradev.in');
  for (const p of pages) {
    const img = await out.embedJpg(p.jpeg);
    const page = out.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  return out.save({ useObjectStreams: true });
}

/** Bytes a PDF adds around its page images (header, page objects, cross-reference table). */
export function pdfOverheadBytes(pages: number): number {
  return 1500 + 450 * pages;
}

export async function compressPdf(file: File, opts: CompressPdfOptions): Promise<CompressPdfResult> {
  if (opts.maxBytes && file.size <= opts.maxBytes) {
    const { pages } = await renderThumbnail(file, 64).catch(() => ({ pages: 0 }));
    return { blob: file, pages, firstPage: null, kept: 'already-small' };
  }

  const { doc, close } = await openPdf(file);
  try {
    const pages = doc.numPages;
    if (pages > MAX_PAGES) {
      throw new PdfError(`This PDF has ${pages} pages. Compressing in the browser works for up to ${MAX_PAGES} pages; split it into smaller parts first.`);
    }

    let pdfBytes: Uint8Array | null = null;
    let first: Blob | null = null;

    if (opts.maxBytes) {
      // Spread the size budget over the pages; pages that come out smaller
      // leave more room for the ones after them. Retry tighter if the
      // finished PDF still overshoots.
      for (const factor of [0.96, 0.88, 0.78]) {
        const budget = opts.maxBytes * factor - pdfOverheadBytes(pages);
        if (budget < pages * 2500) {
          throw new PdfError(
            `A ${pages}-page PDF can't be made that small and still be readable. Try at least ${Math.ceil((pdfOverheadBytes(pages) + pages * 6000) / 1024)} KB, or split the PDF.`,
          );
        }
        const images: PageImage[] = [];
        let used = 0;
        for (let n = 1; n <= pages; n++) {
          opts.onProgress?.(n, pages);
          const perPage = Math.floor((budget - used) / (pages - n + 1));
          const { bitmap, widthPt, heightPt } = await renderPage(doc, n, PDF_PRESETS.balanced.dpi, !!opts.grayscale);
          const initialScale = estimateInitialScale(bitmap.width, bitmap.height, perPage);
          let jpeg: Uint8Array;
          try {
            const out = await compressInWorker(bitmap, { min: 0, max: perPage, aim: Math.floor(perPage * 0.97) }, { allowDownscale: true, initialScale });
            jpeg = new Uint8Array(await out.blob.arrayBuffer());
            if (n === 1) first = out.blob;
          } catch (e) {
            if (e instanceof TooBigError) {
              throw new PdfError(`Page ${n} can't fit in the space left. Try a larger size limit, or turn on black and white.`);
            }
            throw e;
          }
          used += jpeg.length;
          images.push({ jpeg, widthPt, heightPt });
        }
        pdfBytes = await buildPdf(images);
        if (pdfBytes.length <= opts.maxBytes) break;
        pdfBytes = null;
      }
      if (!pdfBytes) throw new PdfError("This PDF couldn't be brought under that size. Try a larger limit or black and white.");
    } else {
      const preset = PDF_PRESETS[opts.preset ?? 'balanced'];
      const images: PageImage[] = [];
      for (let n = 1; n <= pages; n++) {
        opts.onProgress?.(n, pages);
        const { bitmap, widthPt, heightPt } = await renderPage(doc, n, preset.dpi, !!opts.grayscale);
        const out = await encodeInWorker(bitmap, 'jpeg', preset.quality);
        if (n === 1) first = out.blob;
        images.push({ jpeg: new Uint8Array(await out.blob.arrayBuffer()), widthPt, heightPt });
      }
      pdfBytes = await buildPdf(images);
    }

    // Text-only PDFs are often already tiny; never hand back something bigger.
    if (pdfBytes.length >= file.size) {
      return { blob: file, pages, firstPage: null, kept: 'no-gain' };
    }
    return { blob: new Blob([pdfBytes as BlobPart], { type: 'application/pdf' }), pages, firstPage: first, kept: null };
  } finally {
    await close();
  }
}
