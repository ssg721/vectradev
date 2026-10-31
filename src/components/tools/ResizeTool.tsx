import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import CropBox from './CropBox';
import ResultCard, { type Check } from './ResultCard';
import { useBlobUrl, useImage } from './useImage';
import { renderImage, type Rect } from '../../lib/render';
import { compressInWorker, encodeInWorker, TooBigError, type EncodedImage, type OutputFormat, warmUp } from '../../lib/codec';
import { cmToPx, formatBytes, targetBytesFor } from '../../lib/bytes';
import { baseName, downloadBlob, extensionFor } from '../../lib/image';

type Unit = 'px' | 'cm' | 'in';

interface Preset {
  label: string;
  unit: Unit;
  w: number;
  h: number;
  dpi?: number;
}

const PRESETS: Preset[] = [
  { label: 'Passport photo, 3.5 × 4.5 cm', unit: 'cm', w: 3.5, h: 4.5, dpi: 300 },
  { label: 'US visa, 600 × 600 px', unit: 'px', w: 600, h: 600 },
  { label: 'Square, 1080 × 1080 px', unit: 'px', w: 1080, h: 1080 },
  { label: 'Full HD, 1920 × 1080 px', unit: 'px', w: 1920, h: 1080 },
];

const FORMAT_LABEL: Record<OutputFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };

function toPx(v: number, unit: Unit, dpi: number) {
  if (unit === 'px') return Math.round(v);
  if (unit === 'cm') return cmToPx(v, dpi);
  return Math.round(v * dpi);
}

function fromPx(px: number, unit: Unit, dpi: number) {
  if (unit === 'px') return String(Math.round(px));
  const v = unit === 'cm' ? (px / dpi) * 2.54 : px / dpi;
  return String(Math.round(v * 100) / 100);
}

export default function ResizeTool() {
  const { loaded, loading, error: loadError, load } = useImage();
  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState('300');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [locked, setLocked] = useState(true);
  const [mode, setMode] = useState<'crop' | 'fit'>('crop');
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [maxKb, setMaxKb] = useState('');
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EncodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const resultUrl = useBlobUrl(result?.blob ?? null);
  useEffect(() => warmUp(), []);

  const dpiN = Math.max(1, parseInt(dpi, 10) || 300);
  const wPx = toPx(parseFloat(w), unit, dpiN);
  const hPx = toPx(parseFloat(h), unit, dpiN);
  const valid = wPx > 0 && hPx > 0 && wPx <= 12000 && hPx <= 12000;
  const ratio = loaded ? loaded.bitmap.height / loaded.bitmap.width : 1;
  const needsCrop = !!loaded && valid && !locked && mode === 'crop';
  const maxKbN = parseFloat(maxKb);

  // Fill in the original size when a photo is chosen.
  useEffect(() => {
    if (!loaded) return;
    setUnit('px');
    setW(String(loaded.bitmap.width));
    setH(String(loaded.bitmap.height));
    setLocked(true);
  }, [loaded]);

  const editW = (v: string) => {
    setW(v);
    const n = parseFloat(v);
    if (locked && n > 0) setH(fromPx(toPx(n, unit, dpiN) * ratio, unit, dpiN));
  };
  const editH = (v: string) => {
    setH(v);
    const n = parseFloat(v);
    if (locked && n > 0) setW(fromPx(toPx(n, unit, dpiN) / ratio, unit, dpiN));
  };
  const changeUnit = (u: Unit) => {
    if (valid) {
      setW(fromPx(wPx, u, dpiN));
      setH(fromPx(hPx, u, dpiN));
    }
    setUnit(u);
  };
  const applyPreset = (p: Preset) => {
    setUnit(p.unit);
    if (p.dpi) setDpi(String(p.dpi));
    setW(String(p.w));
    setH(String(p.h));
    setLocked(false);
    setMode('crop');
  };

  useEffect(() => {
    if (!loaded || !valid || (needsCrop && !crop)) return;
    const id = ++run.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const frame = await renderImage(loaded.bitmap, {
          width: wPx,
          height: hPx,
          crop: needsCrop ? crop! : undefined,
          fit: locked || mode === 'crop' ? 'cover' : 'contain',
          transparent: format !== 'jpeg',
        });
        const useDpi = unit === 'px' ? undefined : dpiN;
        const out =
          format === 'jpeg' && maxKbN > 0
            ? await compressInWorker(frame, targetBytesFor({ minKb: 0, maxKb: maxKbN }), { allowDownscale: false, initialScale: 1, dpi: useDpi })
            : await encodeInWorker(frame, format, 90, useDpi);
        if (id !== run.current) return;
        setResult(out);
      } catch (e) {
        if (id !== run.current) return;
        setResult(null);
        setError(
          e instanceof TooBigError
            ? `At ${wPx} × ${hPx} px this can't go below ${formatBytes(e.smallestBytes)}. Use a smaller size or raise the KB limit.`
            : 'Something went wrong while resizing. Try a different size or photo.',
        );
      } finally {
        if (id === run.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [loaded, wPx, hPx, locked, mode, crop, format, maxKbN, unit, dpiN, valid, needsCrop]);

  const checks: Check[] = result
    ? [
        { label: 'Dimensions', value: `${result.width} × ${result.height} px`, ok: result.width === wPx && result.height === hPx },
        ...(unit !== 'px' ? [{ label: 'Print size', value: `${w} × ${h} ${unit} at ${dpiN} DPI`, ok: null }] : []),
        {
          label: 'File size',
          value: maxKbN > 0 && format === 'jpeg' ? `${formatBytes(result.blob.size)} (limit ${maxKbN} KB)` : formatBytes(result.blob.size),
          ok: maxKbN > 0 && format === 'jpeg' ? result.blob.size <= maxKbN * 1000 : null,
        },
        { label: 'Format', value: FORMAT_LABEL[format], ok: null },
      ]
    : [];

  const notes: string[] = [];
  if (loaded && valid && (wPx > loaded.bitmap.width * 1.05 || hPx > loaded.bitmap.height * 1.05)) {
    notes.push('This is larger than the original, so it may look slightly soft.');
  }

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0">
        {!loaded ? (
          <>
            <Dropzone onFiles={(f) => load(f[0])} />
            {loading && <p class="mt-3 text-ink-2" role="status">Opening your photo…</p>}
            {loadError && <p class="mt-3 font-semibold text-fail" role="alert">{loadError}</p>}
          </>
        ) : (
          <>
            {needsCrop && (
              <div class="mb-5 rounded-[14px] border border-rule bg-sheet p-4">
                <p class="mb-3 text-sm font-semibold text-ink-2">Position the photo in the new frame</p>
                <CropBox
                  src={loaded.url}
                  imgW={loaded.bitmap.width}
                  imgH={loaded.bitmap.height}
                  aspect={wPx / hPx}
                  onChange={setCrop}
                  resetKey={`${loaded.url}|${(wPx / hPx).toFixed(3)}`}
                />
              </div>
            )}
            <ResultCard
              original={{ url: loaded.url, bytes: loaded.file.size, w: loaded.bitmap.width, h: loaded.bitmap.height }}
              result={result && resultUrl ? { url: resultUrl, bytes: result.blob.size, w: result.width, h: result.height } : null}
              busy={busy}
              busyText="Resizing…"
              error={!valid ? 'Enter a width and height between 1 and 12000 pixels.' : error}
              stamp={{ title: 'Resized', sub: `${result?.width ?? 0} × ${result?.height ?? 0} px` }}
              checks={checks}
              notes={notes}
              downloadLabel={`Download ${FORMAT_LABEL[format]}`}
              onDownload={() =>
                result && downloadBlob(result.blob, `${baseName(loaded.file.name)}-${result.width}x${result.height}.${extensionFor(result.blob.type)}`)
              }
            />
            <div class="mt-4">
              <Dropzone compact onFiles={(f) => load(f[0])} />
            </div>
          </>
        )}
      </div>

      <fieldset class="h-fit rounded-[14px] border border-rule bg-sheet p-5" disabled={!loaded}>
        <legend class="sr-only">Resize settings</legend>
        <div class="flex gap-2" role="group" aria-label="Unit">
          {(['px', 'cm', 'in'] as Unit[]).map((u) => (
            <button type="button" class="chip" aria-pressed={unit === u} onClick={() => changeUnit(u)}>
              {u === 'px' ? 'Pixels' : u === 'cm' ? 'cm' : 'inches'}
            </button>
          ))}
        </div>

        <div class="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label class="block">
            <span class="text-sm font-semibold text-ink-2">Width</span>
            <input class="blank mt-1 text-[1.3rem]" inputMode="decimal" value={w} onInput={(e) => editW((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))} />
          </label>
          <button
            type="button"
            class="mb-1 flex h-10 w-10 items-center justify-center rounded-md border border-rule-strong"
            aria-pressed={locked}
            aria-label={locked ? 'Proportions locked. Select to unlock.' : 'Proportions unlocked. Select to lock.'}
            title={locked ? 'Keeping proportions' : 'Free proportions'}
            onClick={() => {
              const next = !locked;
              setLocked(next);
              if (next && parseFloat(w) > 0) editW(w);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {locked ? (
                <path d="M7 11l4-4M6 8L4.5 9.5a2.8 2.8 0 004 4L10 12M8 6l1.5-1.5a2.8 2.8 0 014 4L12 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              ) : (
                <path d="M6 8L4.5 9.5a2.8 2.8 0 004 4L10 12M8 6l1.5-1.5a2.8 2.8 0 014 4L12 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.5" />
              )}
            </svg>
          </button>
          <label class="block">
            <span class="text-sm font-semibold text-ink-2">Height</span>
            <input class="blank mt-1 text-[1.3rem]" inputMode="decimal" value={h} onInput={(e) => editH((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))} />
          </label>
        </div>
        {unit !== 'px' && (
          <label class="mt-4 block">
            <span class="text-sm font-semibold text-ink-2">DPI</span>
            <input class="blank mt-1" inputMode="numeric" value={dpi} onInput={(e) => setDpi((e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''))} />
            {valid && <span class="tabular mt-1 block text-sm text-ink-3">{`${wPx} × ${hPx} pixels`}</span>}
          </label>
        )}

        {!locked && (
          <div class="mt-5">
            <p class="text-sm font-semibold text-ink-2">When the shape changes</p>
            <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Fit mode">
              <button type="button" class="chip" aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}>Crop to fill</button>
              <button type="button" class="chip" aria-pressed={mode === 'fit'} onClick={() => setMode('fit')}>Fit with margins</button>
            </div>
          </div>
        )}

        <div class="mt-5">
          <p class="text-sm font-semibold text-ink-2">Format</p>
          <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Output format">
            {(['jpeg', 'png', 'webp'] as OutputFormat[]).map((f) => (
              <button type="button" class="chip" aria-pressed={format === f} onClick={() => setFormat(f)}>{FORMAT_LABEL[f]}</button>
            ))}
          </div>
        </div>

        {format === 'jpeg' && (
          <label class="mt-5 block">
            <span class="text-sm font-semibold text-ink-2">Also keep under (KB, optional)</span>
            <input class="blank mt-1" inputMode="decimal" placeholder="No limit" value={maxKb} onInput={(e) => setMaxKb((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))} />
          </label>
        )}

        <div class="mt-6 border-t border-rule pt-4">
          <p class="text-sm font-semibold text-ink-2">Common sizes</p>
          <ul class="mt-1">
            {PRESETS.map((p) => (
              <li>
                <button type="button" class="min-h-[44px] w-full text-left text-[0.95rem] text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink" onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </fieldset>
    </div>
  );
}
