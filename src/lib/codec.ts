/**
 * Main-thread client for the codec worker. One shared worker per page.
 */
import type { WorkerRequest, WorkerResponse, OutputFormat } from './codec.worker';
import type { CompressTarget } from './compress';

export type { OutputFormat };

export interface EncodedImage {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  padded: boolean;
}

export class TooBigError extends Error {
  constructor(public smallestBytes: number) {
    super('too-big');
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The image engine stopped unexpectedly.');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function send(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<EncodedImage> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id }, [req.bitmap]);
  }).then((res) => {
    if (!res.ok) {
      if (res.error === 'too-big') throw new TooBigError(res.smallestBytes ?? 0);
      throw new Error(res.error);
    }
    return {
      blob: new Blob([res.bytes], { type: res.mime }),
      width: res.width,
      height: res.height,
      quality: res.quality,
      padded: res.padded,
    };
  });
}

export function compressInWorker(
  bitmap: ImageBitmap,
  target: CompressTarget,
  opts: { allowDownscale: boolean; initialScale: number; dpi?: number },
): Promise<EncodedImage> {
  return send({ kind: 'compress', bitmap, target, ...opts });
}

export function encodeInWorker(
  bitmap: ImageBitmap,
  format: OutputFormat,
  quality: number,
  dpi?: number,
): Promise<EncodedImage> {
  return send({ kind: 'encode', bitmap, format, quality, dpi });
}

let warmed = false;

/**
 * Loads the worker and the JPEG encoder as soon as a tool appears, so the
 * first photo is processed instantly and the tool keeps working if the
 * connection drops after the page has loaded.
 */
export function warmUp(): void {
  if (warmed || typeof window === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  warmed = true;
  const go = async () => {
    try {
      const bitmap = await createImageBitmap(new ImageData(1, 1));
      await encodeInWorker(bitmap, 'jpeg', 75);
    } catch {
      warmed = false; // try again next time a tool mounts
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(go);
  else setTimeout(go, 300);
}
