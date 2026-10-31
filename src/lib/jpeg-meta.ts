/**
 * Small, dependency-free helpers for editing JPEG bytes.
 *
 * - setJpegDpi: writes the DPI into the JFIF header, so a 200 DPI exam
 *   requirement is reflected in the file's metadata.
 * - padJpeg: some portals reject files that are *below* a minimum size
 *   (for example a 140×60 signature that must be 10–20 KB). We add a
 *   standard JPEG comment segment, which every image viewer ignores,
 *   to bring the file up to the required size without touching the image.
 */

const SOI = [0xff, 0xd8];

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === SOI[0] && b[1] === SOI[1];
}

function jfifSegment(dpi: number): Uint8Array {
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  // FF E0, length 16, "JFIF\0", version 1.01, units=1 (dots per inch), Xdensity, Ydensity, no thumbnail
  return new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    (d >> 8) & 0xff, d & 0xff, (d >> 8) & 0xff, d & 0xff, 0x00, 0x00,
  ]);
}

export function setJpegDpi(input: Uint8Array, dpi: number): Uint8Array {
  if (!isJpeg(input)) return input;
  const hasJfif =
    input[2] === 0xff && input[3] === 0xe0 &&
    input[6] === 0x4a && input[7] === 0x46 && input[8] === 0x49 && input[9] === 0x46 && input[10] === 0x00;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (hasJfif) {
    const out = input.slice();
    out[13] = 1; // units: dots per inch
    out[14] = (d >> 8) & 0xff;
    out[15] = d & 0xff;
    out[16] = (d >> 8) & 0xff;
    out[17] = d & 0xff;
    return out;
  }
  const seg = jfifSegment(d);
  const out = new Uint8Array(input.length + seg.length);
  out.set(input.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(input.subarray(2), 2 + seg.length);
  return out;
}

const MAX_SEGMENT_PAYLOAD = 65533; // 65535 minus the 2 length bytes

/**
 * Inserts comment (FF FE) segments right after the JFIF header so the file
 * becomes `targetBytes` long (or at most 4 bytes more, when the gap is tiny).
 * Returns the input unchanged if it is already that big or bigger.
 */
export function padJpeg(input: Uint8Array, targetBytes: number): Uint8Array {
  if (!isJpeg(input) || input.length >= targetBytes) return input;

  // Insert after APP0 (JFIF) if present, otherwise right after SOI.
  let insertAt = 2;
  if (input[2] === 0xff && input[3] === 0xe0) {
    insertAt = 4 + ((input[4] << 8) | input[5]);
  }

  // Each segment costs 4 bytes of overhead (marker + length) and carries at
  // least 1 byte, so the smallest possible addition is 5 bytes. If fewer are
  // needed we overshoot by up to 4 bytes, which callers allow for.
  let needed = Math.max(5, targetBytes - input.length);
  const segments: Uint8Array[] = [];
  while (needed > 0) {
    let payload = Math.min(MAX_SEGMENT_PAYLOAD, needed - 4);
    const remainder = needed - (payload + 4);
    // Never leave a remainder too small to form its own segment.
    if (remainder > 0 && remainder < 5) payload -= 5 - remainder;
    segments.push(commentSegment(payload));
    needed -= payload + 4;
  }

  const extra = segments.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(input.length + extra);
  out.set(input.subarray(0, insertAt), 0);
  let o = insertAt;
  for (const s of segments) {
    out.set(s, o);
    o += s.length;
  }
  out.set(input.subarray(insertAt), o);
  return out;
}

function commentSegment(payloadLength: number): Uint8Array {
  const len = payloadLength + 2;
  const seg = new Uint8Array(payloadLength + 4);
  seg[0] = 0xff;
  seg[1] = 0xfe;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  // Payload is spaces: a valid, invisible comment.
  seg.fill(0x20, 4);
  return seg;
}
