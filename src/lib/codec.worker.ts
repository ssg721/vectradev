/// <reference lib="webworker" />
/**
 * Runs all encoding off the main thread so the page never freezes on a phone.
 * Receives an ImageBitmap, returns encoded bytes.
 */
import encodeJpeg from '@jsquash/jpeg/encode';
import encodeWebp from '@jsquash/webp/encode';
import { compressToTarget, type CompressTarget } from './compress';
import { setJpegDpi } from './jpeg-meta';

export type OutputFormat = 'jpeg' | 'webp' | 'png';

export type WorkerRequest =
  | {
      id: number;
      kind: 'compress';
      bitmap: ImageBitmap;
      target: CompressTarget;
      allowDownscale: boolean;
      initialScale: number;
      dpi?: number;
    }
  | {
      id: number;
      kind: 'encode';
      bitmap: ImageBitmap;
      format: OutputFormat;
      quality: number;
      dpi?: number;
    };

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      bytes: ArrayBuffer;
      width: number;
      height: number;
      quality: number;
      padded: boolean;
      mime: string;
    }
  | { id: number; ok: false; error: string; smallestBytes?: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Draws the bitmap at `scale`, halving in steps for large reductions so edges stay smooth. */
function pixelsAt(bitmap: ImageBitmap, scale: number): ImageData {
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  let src: CanvasImageSource = bitmap;
  let sw = bitmap.width;
  let sh = bitmap.height;
  while (sw / 2 >= w && sh / 2 >= h) {
    const nw = Math.round(sw / 2);
    const nh = Math.round(sh / 2);
    const step = new OffscreenCanvas(nw, nh);
    const sctx = step.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, nw, nh);
    src = step;
    sw = nw;
    sh = nh;
  }

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function encodeJpegBytes(img: ImageData, quality: number, dpi?: number): Promise<Uint8Array> {
  const buf = await encodeJpeg(img, {
    quality,
    // 4:4:4 chroma keeps thin signature strokes crisp at small sizes.
    chroma_subsample: quality >= 90 ? 1 : 2,
    auto_subsample: false,
  });
  const bytes = new Uint8Array(buf);
  return dpi ? setJpegDpi(bytes, dpi) : bytes;
}

async function handle(req: WorkerRequest): Promise<WorkerResponse> {
  if (req.kind === 'compress') {
    const cache = new Map<number, ImageData>();
    const at = (s: number) => {
      const key = Math.round(s * 10000);
      let img = cache.get(key);
      if (!img) {
        img = pixelsAt(req.bitmap, s);
        cache.clear(); // keep memory flat: only the current scale is needed
        cache.set(key, img);
      }
      return img;
    };
    const result = await compressToTarget({
      encode: (q, s) => encodeJpegBytes(at(s), q, req.dpi),
      target: req.target,
      allowDownscale: req.allowDownscale,
      initialScale: req.initialScale,
    });
    if (!result.ok) {
      return { id: req.id, ok: false, error: 'too-big', smallestBytes: result.smallestBytes };
    }
    const img = at(result.scale);
    const out = result.bytes;
    return {
      id: req.id,
      ok: true,
      bytes: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer,
      width: img.width,
      height: img.height,
      quality: result.quality,
      padded: result.padded,
      mime: 'image/jpeg',
    };
  }

  const img = pixelsAt(req.bitmap, 1);
  let bytes: Uint8Array;
  let mime: string;
  if (req.format === 'jpeg') {
    bytes = await encodeJpegBytes(img, req.quality, req.dpi);
    mime = 'image/jpeg';
  } else if (req.format === 'webp') {
    bytes = new Uint8Array(await encodeWebp(img, { quality: req.quality }));
    mime = 'image/webp';
  } else {
    const canvas = new OffscreenCanvas(img.width, img.height);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = 'image/png';
  }
  return {
    id: req.id,
    ok: true,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    width: img.width,
    height: img.height,
    quality: req.quality,
    padded: false,
    mime,
  };
}

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const res = await handle(req);
    if (res.ok) scope.postMessage(res, [res.bytes]);
    else scope.postMessage(res);
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    req.bitmap.close();
  }
};
