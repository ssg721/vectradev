import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { loadImage, UnsupportedFileError } from '../../lib/image';

export interface Loaded {
  file: File;
  bitmap: ImageBitmap;
  /** Object URL for previews (a JPEG copy for HEIC, so every browser can show it). */
  url: string;
  type: string;
}

/** Loads one file into a decoded bitmap + preview URL, cleaning up the previous one. */
export function useImage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Loaded | null>(null);

  const load = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const { bitmap, type } = await loadImage(file);
      const url = await previewUrl(file, bitmap, type);
      if (current.current) {
        current.current.bitmap.close();
        URL.revokeObjectURL(current.current.url);
      }
      const next = { file, bitmap, url, type };
      current.current = next;
      setLoaded(next);
    } catch (e) {
      setError(
        e instanceof UnsupportedFileError
          ? e.message
          : 'This file could not be opened. Try a different photo, or save it as JPG first.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    if (current.current) {
      current.current.bitmap.close();
      URL.revokeObjectURL(current.current.url);
    }
    current.current = null;
    setLoaded(null);
    setError(null);
  }, []);

  useEffect(() => () => clear(), [clear]);

  return { loaded, loading, error, load, clear };
}

/** Browsers can show JPG/PNG/WebP directly; anything else is shown via a canvas copy. */
async function previewUrl(file: File, bitmap: ImageBitmap, type: string): Promise<string> {
  if (/image\/(jpeg|png|webp|gif|avif)/.test(type)) return URL.createObjectURL(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('preview'))), 'image/jpeg', 0.85));
  return URL.createObjectURL(blob);
}

/** Keeps an object URL for a blob alive exactly as long as the blob is current. */
export function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
