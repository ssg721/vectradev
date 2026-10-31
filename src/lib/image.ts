/**
 * Turning a user's file into something we can draw.
 */

export class UnsupportedFileError extends Error {}

const MAX_PIXELS = 40_000_000; // ~40 MP; larger images are scaled on load to protect phone memory

async function sniff(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ascii.startsWith('\x89PNG')) return 'image/png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('BM')) return 'image/bmp';
  if (ascii.startsWith('%PDF')) return 'application/pdf';
  const brand = ascii.slice(4, 12);
  if (brand === 'ftypheic' || brand === 'ftypheix' || brand === 'ftypmif1' || brand === 'ftypmsf1' || brand === 'ftyphevc') {
    return 'image/heic';
  }
  if (brand === 'ftypavif') return 'image/avif';
  if (ascii.includes('<svg') || ascii.startsWith('<?xml')) return 'image/svg+xml';
  return file.type || 'application/octet-stream';
}

export function isHeic(type: string, name: string): boolean {
  return /image\/hei[cf]/.test(type) || /\.(heic|heif)$/i.test(name);
}

/** Decodes any supported file into an ImageBitmap with the camera rotation applied. */
export async function loadImage(file: File): Promise<{ bitmap: ImageBitmap; type: string }> {
  const type = await sniff(file);

  if (type === 'application/pdf') {
    throw new UnsupportedFileError('This is a PDF. Choose a photo or scan saved as JPG, PNG, WebP or HEIC.');
  }

  let source: Blob = file;
  if (isHeic(type, file.name)) {
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      source = Array.isArray(out) ? out[0] : out;
    } catch {
      throw new UnsupportedFileError(
        'This iPhone photo (HEIC) could not be opened. On your iPhone, open Settings › Camera › Formats and choose "Most Compatible", or share the photo as JPEG.',
      );
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers can't decode SVG via createImageBitmap; fall back to an <img>.
    try {
      bitmap = await viaImgElement(source);
    } catch {
      throw new UnsupportedFileError('This file could not be opened as an image. Try a JPG, PNG, WebP or HEIC file.');
    }
  }

  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height));
    const smaller = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * s),
      resizeHeight: Math.round(bitmap.height * s),
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = smaller;
  }

  return { bitmap, type };
}

async function viaImgElement(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await createImageBitmap(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image';
}

export function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/png') return 'png';
  return 'img';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
