import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import ResultCard, { type Check } from './ResultCard';
import { useBlobUrl } from './useImage';
import { compressPdf, isPdf, loadPdfJs, PdfError, renderThumbnail, type CompressPdfResult, type PdfPresetName } from '../../lib/pdf';
import { warmUp } from '../../lib/codec';
import { formatBytes, maxBytesFor } from '../../lib/bytes';
import { baseName, downloadBlob } from '../../lib/image';

interface Props {
  /** Start in "fit under a size" mode with this limit. */
  defaultMaxKb?: number;
  /** A file already chosen elsewhere (the home page's "photo or PDF" box). */
  initialFile?: File;
}

const QUICK_KB = [100, 200, 500, 1000];
const PRESET_LABEL: Record<PdfPresetName, string> = { smallest: 'Smallest file', balanced: 'Balanced', quality: 'Best quality' };

interface Settings {
  mode: 'size' | 'preset';
  maxKb: number;
  preset: PdfPresetName;
  grayscale: boolean;
}

export default function PdfCompressTool({ defaultMaxKb, initialFile }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [pages, setPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'size' | 'preset'>(defaultMaxKb ? 'size' : 'preset');
  const [maxKbText, setMaxKbText] = useState(String(defaultMaxKb ?? 200));
  const [preset, setPreset] = useState<PdfPresetName>('balanced');
  const [grayscale, setGrayscale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<CompressPdfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const queued = useRef<{ s: Settings; f: File } | null>(null);
  const thumbUrl = useBlobUrl(thumb);
  const resultPreviewUrl = useBlobUrl(result?.firstPage ?? null);

  // Load the engines early so the tool keeps working if the connection drops.
  useEffect(() => {
    warmUp();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    (idle ?? ((cb: () => void) => setTimeout(cb, 500)))(() => {
      loadPdfJs().catch(() => {});
      import('pdf-lib').catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (initialFile) choose(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const maxKb = parseFloat(maxKbText);
  const settingsValid = mode === 'preset' || maxKb > 0;

  const choose = async (f: File) => {
    setLoadError(null);
    setResult(null);
    setError(null);
    if (!(await isPdf(f))) {
      setLoadError('This file is not a PDF. For photos, use the image compressor instead.');
      return;
    }
    try {
      const t = await renderThumbnail(f);
      setFile(f);
      setThumb(t.blob);
      setPages(t.pages);
    } catch (e) {
      console.error(e);
      setFile(null);
      setLoadError(e instanceof PdfError ? e.message : 'This PDF could not be opened.');
    }
  };

  const run = async (s: Settings, f: File) => {
    if (running.current) {
      queued.current = { s, f };
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const out = await compressPdf(f, {
        maxBytes: s.mode === 'size' ? maxBytesFor(s.maxKb) : undefined,
        preset: s.preset,
        grayscale: s.grayscale,
        onProgress: (n, total) => setProgress(total > 1 ? `Compressing page ${n} of ${total}…` : 'Compressing…'),
      });
      setResult(out);
    } catch (e) {
      console.error(e);
      setResult(null);
      setError(e instanceof PdfError ? e.message : 'Something went wrong while compressing this PDF. Try again, or try a smaller file.');
    } finally {
      running.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) run(next.s, next.f);
      else setBusy(false);
    }
  };

  useEffect(() => {
    if (!file || !settingsValid) return;
    const timer = setTimeout(() => run({ mode, maxKb, preset, grayscale }, file), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, mode, maxKb, preset, grayscale, settingsValid]);

  const checks: Check[] = [];
  const notes: string[] = [];
  if (result && file) {
    const size = result.blob.size;
    checks.push({
      label: 'File size',
      value: mode === 'size' ? `${formatBytes(size)} (limit ${maxKb} KB)` : formatBytes(size),
      ok: mode === 'size' ? size <= maxBytesFor(maxKb) : null,
    });
    checks.push({ label: 'Pages', value: String(result.pages || pages), ok: null });
    checks.push({ label: 'Format', value: 'PDF', ok: null });
    if (result.kept === 'already-small') notes.push(`This PDF is already under ${maxKb} KB, so it was left exactly as it is.`);
    else if (result.kept === 'no-gain') notes.push('This PDF is already well compressed (usually a text document), so it was left as it is. Compressing would only make it blurrier.');
    else notes.push('Pages are saved as images, so text in the result cannot be selected or searched.');
  }

  const fits = !!result && (mode !== 'size' || result.blob.size <= maxBytesFor(maxKb));

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0">
        {!file ? (
          <>
            <Dropzone
              onFiles={(f) => choose(f[0])}
              accept="application/pdf,.pdf"
              label="Choose a PDF"
              hint="or drop it here. Scanned documents, certificates and photo-heavy PDFs shrink the most."
            />
            {loadError && <p class="mt-3 font-semibold text-fail" role="alert">{loadError}</p>}
          </>
        ) : (
          <>
            <ResultCard
              original={{ url: thumbUrl ?? '', bytes: file.size, w: 0, h: 0, caption: `${formatBytes(file.size)}, ${pages} ${pages === 1 ? 'page' : 'pages'}` }}
              result={
                result
                  ? {
                      url: resultPreviewUrl ?? thumbUrl ?? '',
                      bytes: result.blob.size,
                      w: 0,
                      h: 0,
                      caption: `${formatBytes(result.blob.size)}, ${result.pages || pages} ${(result.pages || pages) === 1 ? 'page' : 'pages'}`,
                    }
                  : null
              }
              busy={busy}
              busyText={progress || 'Compressing…'}
              error={!settingsValid ? 'Enter the maximum size in KB.' : error}
              stamp={fits && !result?.kept ? { title: 'Fits', sub: mode === 'size' ? `${formatBytes(result!.blob.size)} of ${maxKb} KB` : formatBytes(result!.blob.size) } : null}
              checks={checks}
              notes={notes}
              downloadLabel="Download PDF"
              onDownload={() => result && downloadBlob(result.blob, `${baseName(file.name)}${result.kept ? '' : '-compressed'}.pdf`)}
            />
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Dropzone compact accept="application/pdf,.pdf" onFiles={(f) => choose(f[0])} />
              {loadError && <p class="font-semibold text-fail" role="alert">{loadError}</p>}
            </div>
          </>
        )}
      </div>

      <fieldset class="h-fit rounded-[14px] border border-rule bg-sheet p-5">
        <legend class="sr-only">Compression settings</legend>
        <div class="flex flex-wrap gap-2" role="group" aria-label="How to compress">
          <button type="button" class="chip" aria-pressed={mode === 'size'} onClick={() => setMode('size')}>
            Under a size
          </button>
          <button type="button" class="chip" aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}>
            By quality
          </button>
        </div>

        {mode === 'size' ? (
          <div class="mt-5">
            <label class="block">
              <span class="text-sm font-semibold text-ink-2">Maximum size (KB)</span>
              <input
                class="blank mt-1 text-[1.6rem]"
                inputMode="decimal"
                value={maxKbText}
                aria-invalid={!(maxKb > 0)}
                onInput={(e) => setMaxKbText((e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, ''))}
              />
            </label>
            <div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Common sizes">
              {QUICK_KB.map((kb) => (
                <button type="button" class="chip" aria-pressed={maxKb === kb} onClick={() => setMaxKbText(String(kb))}>
                  {kb >= 1000 ? `${kb / 1000} MB` : `${kb} KB`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div class="mt-5 space-y-1" role="radiogroup" aria-label="Quality">
            {(Object.keys(PRESET_LABEL) as PdfPresetName[]).map((p) => (
              <label class="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input type="radio" name="pdf-preset" class="h-5 w-5 accent-[var(--stamp)]" checked={preset === p} onChange={() => setPreset(p)} />
                <span class="text-[0.95rem]">{PRESET_LABEL[p]}</span>
              </label>
            ))}
          </div>
        )}

        <label class="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3">
          <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={grayscale} onChange={(e) => setGrayscale((e.currentTarget as HTMLInputElement).checked)} />
          <span class="text-[0.95rem]">
            Black and white
            <span class="block text-sm text-ink-3">Smaller files for text documents and certificates.</span>
          </span>
        </label>

        <p class="mt-5 border-t border-rule pt-4 text-sm text-ink-3">
          Works best on scanned documents. A PDF that's already small is left as it is.
        </p>
      </fieldset>
    </div>
  );
}
