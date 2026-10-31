/**
 * Portals disagree on whether "1 KB" means 1000 or 1024 bytes.
 * To be accepted by both, we check the upper limit with 1000 (stricter)
 * and the lower limit with 1024 (stricter).
 */
export function maxBytesFor(kb: number): number {
  return Math.floor(kb * 1000);
}

export function minBytesFor(kb: number): number {
  return Math.ceil(kb * 1024);
}

/** Human-readable size, using 1024-based KB like most file managers. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** Converts a physical length in cm to pixels at a given DPI. */
export function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

export function pxToCm(px: number, dpi: number): number {
  return Math.round((px / dpi) * 2.54 * 100) / 100;
}

export interface SizeRange {
  /** Minimum size in KB, or 0 for no minimum. */
  minKb: number;
  /** Maximum size in KB. */
  maxKb: number;
}

/**
 * Where to aim inside an allowed range.
 * For a range like 20–50 KB we aim for the middle so small differences in how
 * a portal measures size never cause a rejection. For a "max only" limit
 * we aim slightly under the max to keep as much quality as possible.
 */
export function targetBytesFor(range: SizeRange): { min: number; max: number; aim: number } {
  const max = maxBytesFor(range.maxKb);
  const min = range.minKb > 0 ? minBytesFor(range.minKb) : 0;
  if (min === 0) return { min, max, aim: Math.floor(max * 0.96) };
  const mid = Math.floor((min + max) / 2);
  return { min, max, aim: mid };
}
