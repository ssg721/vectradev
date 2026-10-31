import { describe, expect, it } from 'vitest';
import { compressToTarget, estimateInitialScale, type EncodeAt } from './compress';
import { padJpeg, setJpegDpi } from './jpeg-meta';
import { maxBytesFor, minBytesFor, targetBytesFor, cmToPx } from './bytes';

/** A fake JPEG: SOI + JFIF APP0 + filler + EOI, sized like a real encoder would be. */
function fakeJpeg(size: number): Uint8Array {
  const b = new Uint8Array(Math.max(24, size));
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  b[b.length - 2] = 0xff;
  b[b.length - 1] = 0xd9;
  return b;
}

/** Size grows with quality and with pixel count, like real JPEG output. */
function fakeEncoder(fullSizeAtQ100: number, floorBytes = 600): EncodeAt & { calls: number } {
  const fn = (async (q: number, scale: number) => {
    fn.calls++;
    const qFactor = 0.08 + 0.92 * Math.pow(q / 100, 3);
    return fakeJpeg(Math.round(floorBytes + fullSizeAtQ100 * qFactor * scale * scale));
  }) as EncodeAt & { calls: number };
  fn.calls = 0;
  return fn;
}

describe('size limits', () => {
  it('uses the stricter KB definition at each end of the range', () => {
    expect(maxBytesFor(50)).toBe(50_000);
    expect(minBytesFor(20)).toBe(20_480);
  });

  it('aims for the middle of a range and just under a max-only limit', () => {
    const r = targetBytesFor({ minKb: 20, maxKb: 50 });
    expect(r.aim).toBeGreaterThan(r.min);
    expect(r.aim).toBeLessThan(r.max);
    expect(targetBytesFor({ minKb: 0, maxKb: 100 }).aim).toBe(96_000);
  });

  it('converts cm to pixels', () => {
    expect(cmToPx(3.5, 200)).toBe(276);
  });
});

describe('JPEG metadata', () => {
  it('writes DPI into the JFIF header', () => {
    const out = setJpegDpi(fakeJpeg(1000), 200);
    expect(out[13]).toBe(1);
    expect((out[14] << 8) | out[15]).toBe(200);
    expect((out[16] << 8) | out[17]).toBe(200);
  });

  it('adds a JFIF header when missing', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
    const out = setJpegDpi(bare, 300);
    expect(out.length).toBe(bare.length + 18);
    expect(out[3]).toBe(0xe0);
  });

  it.each([5, 100, 9_000, 65_537, 65_540, 140_000])('pads to the exact target (+%i bytes)', (extra) => {
    const src = fakeJpeg(3_000);
    const out = padJpeg(src, src.length + extra);
    expect(out.length).toBe(src.length + extra);
    // Still starts with SOI + APP0 and ends with EOI.
    expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([0xff, 0xd9]);
  });

  it('never overshoots by more than 4 bytes for tiny gaps', () => {
    const src = fakeJpeg(3_000);
    const out = padJpeg(src, src.length + 2);
    expect(out.length - src.length).toBeLessThanOrEqual(6);
    expect(out.length).toBeGreaterThanOrEqual(src.length + 2);
  });

  it('leaves files that are already big enough untouched', () => {
    const src = fakeJpeg(3_000);
    expect(padJpeg(src, 1_000)).toBe(src);
  });
});

describe('compressToTarget', () => {
  it('finds a quality that lands inside a 20–50 KB range', async () => {
    const target = targetBytesFor({ minKb: 20, maxKb: 50 });
    const r = await compressToTarget({ encode: fakeEncoder(400_000), target, allowDownscale: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.length).toBeLessThanOrEqual(target.aim);
    expect(r.bytes.length).toBeGreaterThanOrEqual(target.min);
    expect(r.padded).toBe(false);
    expect(r.encodes).toBeLessThanOrEqual(10);
  });

  it('pads a tiny signature that is below the minimum', async () => {
    const target = targetBytesFor({ minKb: 10, maxKb: 20 });
    const r = await compressToTarget({ encode: fakeEncoder(3_000), target, allowDownscale: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.padded).toBe(true);
    expect(r.bytes.length).toBeGreaterThanOrEqual(target.min);
    expect(r.bytes.length).toBeLessThanOrEqual(target.max);
  });

  it('shrinks a huge photo when resizing is allowed', async () => {
    const target = targetBytesFor({ minKb: 0, maxKb: 20 });
    const r = await compressToTarget({ encode: fakeEncoder(8_000_000), target, allowDownscale: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scale).toBeLessThan(1);
    expect(r.bytes.length).toBeLessThanOrEqual(target.max);
  });

  it('reports failure when the size is impossible without resizing', async () => {
    const target = targetBytesFor({ minKb: 0, maxKb: 20 });
    const r = await compressToTarget({ encode: fakeEncoder(8_000_000), target, allowDownscale: false });
    expect(r.ok).toBe(false);
  });

  it('keeps top quality in one encode when the image is already small enough', async () => {
    const target = targetBytesFor({ minKb: 0, maxKb: 500 });
    const enc = fakeEncoder(100_000);
    const r = await compressToTarget({ encode: enc, target, allowDownscale: false });
    expect(r.ok && r.quality).toBe(95);
    expect(enc.calls).toBe(1);
  });

  it('uses most of the size budget instead of shrinking too far', async () => {
    const target = targetBytesFor({ minKb: 0, maxKb: 50 });
    // Start from a deliberately pessimistic small scale.
    const r = await compressToTarget({ encode: fakeEncoder(6_000_000), target, allowDownscale: true, initialScale: 0.05 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.length).toBeGreaterThan(target.aim * 0.7);
    expect(r.bytes.length).toBeLessThanOrEqual(target.max);
    expect(r.quality).toBeGreaterThanOrEqual(60);
  });

  it('prefers a smaller sharp image over a large blocky one', async () => {
    const target = targetBytesFor({ minKb: 0, maxKb: 20 });
    const r = await compressToTarget({ encode: fakeEncoder(3_000_000), target, allowDownscale: true, initialScale: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quality).toBeGreaterThanOrEqual(55);
  });

  it('estimates a sensible starting scale for big photos', () => {
    expect(estimateInitialScale(4000, 3000, 20_000)).toBeLessThan(0.2);
    expect(estimateInitialScale(200, 230, 50_000)).toBe(1);
  });
});
