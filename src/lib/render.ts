/**
 * Builds the final picture before encoding: crop, resize, clean up scanned
 * paper, trim empty margins and add an optional name/date strip.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Caption {
  name: string;
  date: string;
}

export interface RenderOptions {
  /** Output size in pixels. Omit both and set autoMaxEdge to size the output from the (trimmed) content. */
  width?: number;
  height?: number;
  autoMaxEdge?: number;
  /** Source area to use. Defaults to the whole image. */
  crop?: Rect;
  /** 'cover' fills the frame (crop area must match the aspect); 'contain' fits inside with white margins. */
  fit: 'cover' | 'contain';
  /** Makes grey/yellow phone-photographed paper white and ink darker. */
  cleanPaper?: boolean;
  /** Adds a white strip with name and date at the bottom. */
  caption?: Caption | null;
  /** Keep transparency (PNG/WebP output). Otherwise transparent areas become white. */
  transparent?: boolean;
  /** -100..100 each; 0 leaves the image unchanged. Applied to the final picture area. */
  brightness?: number;
  contrast?: number;
  /** 0..100 for cleanPaper: higher whitens more of the paper and darkens ink more. Default 50. */
  inkStrength?: number;
}

export const CAPTION_RATIO = 0.18;

/** The aspect ratio of the photo area once a caption strip is reserved. */
export function photoAspect(width: number, height: number, withCaption: boolean): number {
  const h = withCaption ? height - Math.round(height * CAPTION_RATIO) : height;
  return width / h;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Copies (part of) a bitmap into a canvas so its pixels can be processed. */
function toCanvas(bitmap: ImageBitmap, crop?: Rect, transparent = false): HTMLCanvasElement {
  const r = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const c = canvas(r.w, r.h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (!transparent) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

function luminance(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Percentile of luminance using a 256-bin histogram (fast on large images). */
function lumPercentile(d: Uint8ClampedArray, p: number): number {
  const hist = new Uint32Array(256);
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[luminance(d, i) | 0]++;
  const target = n * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Levels adjustment tuned for ink on paper: the paper tone becomes pure white,
 * ink becomes darker, and the ink's colour (blue or black) is kept.
 */
export function cleanPaper(c: HTMLCanvasElement, strength = 50): void {
  const t = Math.min(100, Math.max(0, strength)) / 100;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const paper = lumPercentile(d, 0.6); // most of a signature image is paper
  const ink = Math.min(lumPercentile(d, 0.02), paper - 40);
  // At the default strength this matches the original tuning (0.25 / 0.55).
  const white = paper - (paper - ink) * (0.05 + 0.4 * t);
  const keep = 0.8 - 0.5 * t; // how much of the ink's own brightness to keep
  const range = Math.max(1, white - ink);
  for (let i = 0; i < d.length; i += 4) {
    const t = Math.min(1, Math.max(0, (luminance(d, i) - ink) / range));
    const k = t * t; // keep strokes solid, fade near-paper tones out quickly
    d[i] = d[i] * keep * (1 - k) + 255 * k;
    d[i + 1] = d[i + 1] * keep * (1 - k) + 255 * k;
    d[i + 2] = d[i + 2] * keep * (1 - k) + 255 * k;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Bounding box of non-white content, with a margin. Used to trim signatures. */
export function contentBounds(c: HTMLCanvasElement, threshold = 200, marginRatio = 0.08): Rect | null {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (luminance(data, i) < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const m = Math.round(Math.max(w, h) * marginRatio);
  const x = Math.max(0, minX - m);
  const y = Math.max(0, minY - m);
  return { x, y, w: Math.min(c.width - x, w + 2 * m), h: Math.min(c.height - y, h + 2 * m) };
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: Caption, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = [caption.name.trim(), caption.date.trim()].filter(Boolean);
  if (!lines.length) return;
  const lineH = h / lines.length;
  for (let i = 0; i < lines.length; i++) {
    let size = Math.floor(lineH * 0.72);
    ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
    while (size > 6 && ctx.measureText(lines[i]).width > w * 0.94) {
      size--;
      ctx.font = `700 ${size}px Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(lines[i], x + w / 2, y + lineH * (i + 0.5));
  }
}

/** Renders the final image and returns it as an ImageBitmap ready for the encoder. */
export async function renderImage(bitmap: ImageBitmap, opts: RenderOptions): Promise<ImageBitmap> {
  let src = toCanvas(bitmap, opts.crop, opts.transparent);
  if (opts.cleanPaper) cleanPaper(src, opts.inkStrength ?? 50);

  if (opts.fit === 'contain' && opts.cleanPaper) {
    // Trim empty paper around a signature or thumb impression before fitting it.
    const b = contentBounds(src);
    if (b && (b.w < src.width * 0.95 || b.h < src.height * 0.95)) {
      const t = canvas(b.w, b.h);
      t.getContext('2d')!.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      src = t;
    }
  }

  let width = opts.width;
  let height = opts.height;
  if (width === undefined || height === undefined) {
    const edge = opts.autoMaxEdge ?? Math.max(src.width, src.height);
    const s = Math.min(1, edge / Math.max(src.width, src.height));
    width = Math.max(1, Math.round(src.width * s));
    height = Math.max(1, Math.round(src.height * s));
    if (opts.caption) height = Math.round(height / (1 - CAPTION_RATIO));
  }

  const out = canvas(width, height);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (!opts.transparent) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
  }

  const stripH = opts.caption ? Math.round(out.height * CAPTION_RATIO) : 0;
  const areaW = out.width;
  const areaH = out.height - stripH;

  if (opts.fit === 'cover') {
    ctx.drawImage(stepDown(src, areaW, areaH), 0, 0, areaW, areaH);
  } else {
    const s = Math.min(areaW / src.width, areaH / src.height);
    const dw = Math.round(src.width * s);
    const dh = Math.round(src.height * s);
    ctx.drawImage(stepDown(src, dw, dh), Math.round((areaW - dw) / 2), Math.round((areaH - dh) / 2), dw, dh);
  }

  if (opts.brightness || opts.contrast) adjustArea(ctx, out.width, areaH, opts.brightness ?? 0, opts.contrast ?? 0);
  if (opts.caption) drawCaption(ctx, opts.caption, 0, areaH, out.width, stripH);

  return createImageBitmap(out);
}

/** Halves the image in steps for big reductions; one big jump looks jagged. */
function stepDown(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const next = canvas(cur.width / 2, cur.height / 2);
    const ctx = next.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

/** Largest crop of the given aspect ratio, centred, slightly favouring the top (faces). */
export function centeredCrop(imgW: number, imgH: number, aspect: number, topBias = 0.45): Rect {
  let w = imgW;
  let h = imgW / aspect;
  if (h > imgH) {
    h = imgH;
    w = imgH * aspect;
  }
  return {
    x: Math.round((imgW - w) / 2),
    y: Math.round((imgH - h) * topBias),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** Brightness/contrast on the picture area (not the caption strip). Values -100..100. */
function adjustArea(ctx: CanvasRenderingContext2D, w: number, h: number, brightness: number, contrast: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const b = (brightness / 100) * 80;
  const c = Math.tan(((contrast / 100) * 0.9 + 1) * (Math.PI / 4)); // 0.16..6.3, 1 at 0
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = (v - 128) * c + 128 + b;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  ctx.putImageData(img, 0, 0);
}

/** Rotates a bitmap by a multiple of 90 degrees. */
export async function rotateBitmap(bitmap: ImageBitmap, degrees: 0 | 90 | 180 | 270): Promise<ImageBitmap> {
  if (degrees === 0) return createImageBitmap(bitmap);
  const swap = degrees === 90 || degrees === 270;
  const c = canvas(swap ? bitmap.height : bitmap.width, swap ? bitmap.width : bitmap.height);
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  return createImageBitmap(c);
}

export interface QuickCheck {
  label: string;
  value: string;
  ok: true | 'warn';
}

/**
 * Simple, honest checks on the finished picture. They can't judge everything
 * a portal or examiner might, so problems are shown as warnings, not failures.
 */
export async function quickChecks(bitmap: ImageBitmap, kind: 'photo' | 'paper', photoAreaRatio = 1): Promise<QuickCheck[]> {
  const W = 96;
  const H = Math.max(8, Math.round((bitmap.height / bitmap.width) * W));
  const c = canvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const lum = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };

  if (kind === 'paper') {
    let ink = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum(x, y) < 140) ink++;
    const share = ink / (W * H);
    if (share < 0.004) return [{ label: 'Ink', value: 'Very little ink found. Is the writing clear and dark?', ok: 'warn' }];
    if (share > 0.45) return [{ label: 'Ink', value: 'Looks very dark. Use white paper and good light.', ok: 'warn' }];
    return [{ label: 'Ink', value: 'Clear on a white background', ok: true }];
  }

  // Photo: sample a frame around the top and sides (the bottom is usually clothing).
  const photoH = Math.round(H * photoAreaRatio);
  const band = Math.max(2, Math.round(W * 0.07));
  const edge: number[] = [];
  for (let y = 0; y < photoH * 0.75; y++) {
    for (let x = 0; x < W; x++) {
      if (y < band || x < band || x >= W - band) edge.push(lum(x, y));
    }
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const bgMean = mean(edge);
  const bgStd = Math.sqrt(mean(edge.map((v) => (v - bgMean) ** 2)));
  const centre: number[] = [];
  for (let y = Math.round(photoH * 0.25); y < Math.round(photoH * 0.6); y++) {
    for (let x = Math.round(W * 0.3); x < Math.round(W * 0.7); x++) centre.push(lum(x, y));
  }
  const faceMean = mean(centre);

  const checks: QuickCheck[] = [];
  if (bgMean >= 175 && bgStd <= 32) checks.push({ label: 'Background', value: 'Plain and light', ok: true });
  else if (bgMean < 175) checks.push({ label: 'Background', value: 'Looks dark. Most forms want plain white or light.', ok: 'warn' });
  else checks.push({ label: 'Background', value: 'Looks busy. Use a plain wall behind you.', ok: 'warn' });

  if (faceMean < 80) checks.push({ label: 'Lighting', value: 'Face looks dark. Try more light, or raise Brightness.', ok: 'warn' });
  else if (faceMean > 225) checks.push({ label: 'Lighting', value: 'Looks washed out. Lower Brightness a little.', ok: 'warn' });
  else checks.push({ label: 'Lighting', value: 'Face is well lit', ok: true });
  return checks;
}
