import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import ResultCard, { type Check } from './ResultCard';
import { useBlobUrl, useImage } from './useImage';
import { renderImage } from '../../lib/render';
import { compressInWorker, TooBigError, type EncodedImage, warmUp } from '../../lib/codec';
import { estimateInitialScale } from '../../lib/compress';
import { formatBytes, targetBytesFor } from '../../lib/bytes';
import { baseName, downloadBlob } from '../../lib/image';

interface Props {
  defaultMaxKb?: number;
}

const QUICK = [20, 50, 100, 200];

export default function CompressTool({ defaultMaxKb = 100 }: Props) {
  const { loaded, loading, error: loadError, load } = useImage();
  const [maxKb, setMaxKb] = useState(String(defaultMaxKb));
  const [useMin, setUseMin] = useState(false);
  const [minKb, setMinKb] = useState('');
  const [keepPixels, setKeepPixels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EncodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const resultUrl = useBlobUrl(result?.blob ?? null);
  useEffect(() => warmUp(), []);

  const max = parseFloat(maxKb);
  const min = useMin ? parseFloat(minKb) || 0 : 0;
  const validationError =
    !(max > 0) ? 'Enter the maximum size in KB.' : min >= max ? 'The minimum must be smaller than the maximum.' : null;

  useEffect(() => {
    if (!loaded || validationError) return;
    const id = ++run.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const target = targetBytesFor({ minKb: min, maxKb: max });
        const { bitmap } = loaded;
        const frame = await renderImage(bitmap, { width: bitmap.width, height: bitmap.height, fit: 'cover' });
        const out = await compressInWorker(frame, target, {
          allowDownscale: !keepPixels,
          initialScale: keepPixels ? 1 : estimateInitialScale(bitmap.width, bitmap.height, target.aim),
        });
        if (id !== run.current) return;
        setResult(out);
      } catch (e) {
        if (id !== run.current) return;
        setResult(null);
        setError(
          e instanceof TooBigError
            ? `This photo can't go below ${formatBytes(e.smallestBytes)} at its current pixel size. Turn off "Keep the pixel size", or raise the limit.`
            : 'Something went wrong while compressing. Try again, or use a different photo.',
        );
      } finally {
        if (id === run.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [loaded, max, min, keepPixels, validationError]);

  const checks: Check[] = [];
  if (result) {
    const t = targetBytesFor({ minKb: min, maxKb: max });
    const size = result.blob.size;
    checks.push({
      label: 'File size',
      value: `${formatBytes(size)} (limit ${min > 0 ? `${min}–` : 'up to '}${max} KB)`,
      ok: size <= t.max && size >= t.min,
    });
    checks.push({ label: 'Dimensions', value: `${result.width} × ${result.height} px`, ok: null });
    checks.push({ label: 'Format', value: 'JPG', ok: null });
  }

  const notes: string[] = [];
  if (result && loaded && result.width < loaded.bitmap.width) {
    notes.push(`The photo was resized from ${loaded.bitmap.width} × ${loaded.bitmap.height} px to reach this size with good quality.`);
  }
  if (result?.padded) {
    notes.push('The image was already small, so invisible padding was added to meet the minimum size. It looks exactly the same.');
  }

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0">
        {!loaded ? (
          <>
            <Dropzone onFiles={(f) => load(f[0])} />
            {loading && <p class="mt-3 text-ink-2" role="status">Opening your photo…</p>}
            {loadError && <p class="mt-3 font-semibold text-fail" role="alert">{loadError}</p>}
          </>
        ) : (
          <>
            <ResultCard
              original={{ url: loaded.url, bytes: loaded.file.size, w: loaded.bitmap.width, h: loaded.bitmap.height }}
              result={result && resultUrl ? { url: resultUrl, bytes: result.blob.size, w: result.width, h: result.height } : null}
              busy={busy}
              busyText={`Fitting it under ${maxKb} KB…`}
              error={validationError ?? error}
              stamp={{ title: 'Fits', sub: `${formatBytes(result?.blob.size ?? 0)} of ${max} KB` }}
              checks={checks}
              notes={notes}
              downloadLabel="Download JPG"
              onDownload={() => result && downloadBlob(result.blob, `${baseName(loaded.file.name)}-${max}kb.jpg`)}
            />
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Dropzone compact onFiles={(f) => load(f[0])} />
              {loadError && <p class="font-semibold text-fail" role="alert">{loadError}</p>}
            </div>
          </>
        )}
      </div>

      <fieldset class="h-fit rounded-[14px] border border-rule bg-sheet p-5">
        <legend class="sr-only">Size settings</legend>
        <label class="block">
          <span class="text-sm font-semibold text-ink-2">Maximum size (KB)</span>
          <input
            class="blank mt-1 text-[1.6rem]"
            inputMode="decimal"
            value={maxKb}
            aria-invalid={!(max > 0)}
            onInput={(e) => setMaxKb((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
          />
        </label>
        <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Common sizes">
          {QUICK.map((kb) => (
            <button type="button" class="chip" aria-pressed={max === kb} onClick={() => setMaxKb(String(kb))}>
              {kb} KB
            </button>
          ))}
        </div>

        <label class="mt-6 flex min-h-[44px] cursor-pointer items-center gap-3">
          <input type="checkbox" class="h-5 w-5 accent-[var(--stamp)]" checked={useMin} onChange={(e) => setUseMin((e.currentTarget as HTMLInputElement).checked)} />
          <span class="text-[0.95rem]">The form also has a minimum size</span>
        </label>
        {useMin && (
          <label class="mt-1 block">
            <span class="text-sm font-semibold text-ink-2">Minimum size (KB)</span>
            <input
              class="blank mt-1 text-[1.3rem]"
              inputMode="decimal"
              value={minKb}
              placeholder="e.g. 20"
              onInput={(e) => setMinKb((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
            />
          </label>
        )}

        <label class="mt-3 flex min-h-[44px] cursor-pointer items-start gap-3">
          <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={keepPixels} onChange={(e) => setKeepPixels((e.currentTarget as HTMLInputElement).checked)} />
          <span class="text-[0.95rem]">
            Keep the pixel size
            <span class="block text-sm text-ink-3">Only lower the quality. Turn on if the form also checks width and height.</span>
          </span>
        </label>

        <p class="mt-5 border-t border-rule pt-4 text-sm text-ink-3">
          We aim a little under the limit{useMin ? ' and above the minimum' : ''}, so every website measures it as fitting.
        </p>
      </fieldset>
    </div>
  );
}
