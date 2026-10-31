/**
 * The "fit under a size limit" search. It is pure (the encoder is passed in)
 * so it can be unit-tested without a browser.
 *
 * Strategy:
 * 1. At the current scale, binary-search the highest JPEG quality whose
 *    output is at or below the aim size.
 * 2. If even the lowest quality is too big and resizing is allowed,
 *    shrink the image and try again.
 * 3. If even the highest quality is below the minimum, pad the file with an
 *    invisible JPEG comment so portals with a minimum size accept it.
 */
import { padJpeg } from './jpeg-meta';

export type EncodeAt = (quality: number, scale: number) => Promise<Uint8Array>;

export interface CompressTarget {
  /** Minimum bytes (0 = no minimum). */
  min: number;
  /** Hard maximum in bytes. */
  max: number;
  /** Size we try to land at or below. Must be <= max. */
  aim: number;
}

export interface CompressOptions {
  encode: EncodeAt;
  target: CompressTarget;
  /** Allow shrinking the pixel dimensions if quality alone isn't enough. */
  allowDownscale: boolean;
  /** Scale to start from (1 = full size). Lets callers skip obviously hopeless sizes. */
  initialScale?: number;
  minQuality?: number;
  maxQuality?: number;
}

export type CompressResult =
  | { ok: true; bytes: Uint8Array; quality: number; scale: number; padded: boolean; encodes: number }
  | { ok: false; reason: 'too-big'; smallestBytes: number; encodes: number };

const MIN_SCALE = 0.05;

export async function compressToTarget(opts: CompressOptions): Promise<CompressResult> {
  const { encode, target, allowDownscale } = opts;
  const minQ = opts.minQuality ?? 8;
  const maxQ = opts.maxQuality ?? 95;
  let scale = Math.min(1, Math.max(MIN_SCALE, opts.initialScale ?? 1));
  let encodes = 0;
  let smallest = Infinity;

  const run = async (q: number, s: number) => {
    encodes++;
    const out = await encode(q, s);
    smallest = Math.min(smallest, out.length);
    return out;
  };

  // When resizing is allowed we steer towards a quality band that looks good
  // (roughly 60–85) by growing or shrinking the pixel size, instead of
  // spending bytes on q95 at a tiny size or q15 at a huge one.
  const topQ = allowDownscale ? Math.min(maxQ, 85) : maxQ;
  const GOOD_Q = 60;
  let lastMove: 'grow' | 'shrink' | null = null;
  let candidate: { bytes: Uint8Array; q: number; scale: number } | null = null;

  for (let round = 0; round < 8; round++) {
    // Best case: the highest quality already fits.
    const top = await run(topQ, scale);
    if (top.length <= target.aim) {
      const roomToGrow = allowDownscale && scale < 1 && top.length < target.aim * 0.85 && lastMove !== 'shrink';
      if (!roomToGrow) return finish(top, topQ, scale);
      candidate = { bytes: top, q: topQ, scale };
      scale = Math.min(1, scale * Math.sqrt(target.aim / top.length) * 0.97);
      lastMove = 'grow';
      continue;
    }

    const bottom = await run(minQ, scale);
    if (bottom.length > target.max) {
      if (!allowDownscale || scale <= MIN_SCALE) break;
      // Shrink in proportion to how far over we are (size scales roughly with pixel count).
      const ratio = Math.sqrt(target.aim / bottom.length) * 0.92;
      scale = Math.max(MIN_SCALE, scale * Math.min(0.9, ratio));
      continue;
    }

    // Binary search the highest quality <= aim. `bottom` is a known fallback.
    let lo = minQ;
    let hi = topQ - 1;
    let best: { bytes: Uint8Array; q: number } | null =
      bottom.length <= target.aim ? { bytes: bottom, q: minQ } : null;
    // `bottom` is known to be <= max here.
    let fallback: { bytes: Uint8Array; q: number } = { bytes: bottom, q: minQ };
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid === minQ) {
        lo = mid + 1;
        continue;
      }
      const out = await run(mid, scale);
      if (out.length <= target.aim) {
        best = { bytes: out, q: mid };
        lo = mid + 1;
      } else {
        // Over the aim but under the hard max: keep it in case nothing fits the aim.
        if (out.length <= target.max && mid > fallback.q) fallback = { bytes: out, q: mid };
        hi = mid - 1;
      }
    }

    const found = best ?? fallback;
    const tooBlurry = allowDownscale && found.q < GOOD_Q && scale > MIN_SCALE && lastMove !== 'grow' && round < 7;
    if (!tooBlurry) return finish(found.bytes, found.q, scale);
    // A smaller, sharper photo beats a big blocky one.
    candidate = { bytes: found.bytes, q: found.q, scale };
    scale = Math.max(MIN_SCALE, scale * 0.8);
    lastMove = 'shrink';
  }

  if (candidate) return finish(candidate.bytes, candidate.q, candidate.scale);

  return { ok: false, reason: 'too-big', smallestBytes: smallest, encodes };

  async function finish(bytes: Uint8Array, quality: number, s: number): Promise<CompressResult> {
    // Stay comfortably above a minimum, not right at its edge.
    const floor = target.min > 0 ? Math.min(target.max - 8, Math.max(target.min + 1024, Math.round(target.min * 1.1))) : 0;
    if (bytes.length >= floor) return { ok: true, bytes, quality, scale: s, padded: false, encodes };

    // Try the very best quality first; only pad if it is still too small.
    let out = bytes;
    let q = quality;
    if (quality < 100) {
      const best = await run(100, s);
      if (best.length <= target.aim) {
        out = best;
        q = 100;
      }
    }
    if (out.length >= floor) return { ok: true, bytes: out, quality: q, scale: s, padded: false, encodes };
    return { ok: true, bytes: padJpeg(out, floor), quality: q, scale: s, padded: true, encodes };
  }
}

/**
 * Rough starting scale for "make this photo X KB" when resizing is allowed:
 * assume about 1.5 bits per pixel at medium-high quality. This avoids wasting
 * encodes on a 12-megapixel photo when the target is 20 KB.
 */
export function estimateInitialScale(width: number, height: number, aimBytes: number): number {
  const pixels = width * height;
  const affordablePixels = (aimBytes * 8) / 1.5;
  if (pixels <= affordablePixels) return 1;
  return Math.sqrt(affordablePixels / pixels);
}
