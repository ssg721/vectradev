import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import CropBox from './CropBox';
import ResultCard, { type Check } from './ResultCard';
import { useBlobUrl, useImage } from './useImage';
import { photoAspect, renderImage, type Rect } from '../../lib/render';
import { compressInWorker, TooBigError, type EncodedImage } from '../../lib/codec';
import { formatBytes, targetBytesFor } from '../../lib/bytes';
import { downloadBlob } from '../../lib/image';

/** Mirrors the document schema in src/content.config.ts. */
export interface ExamDocument {
  id: string;
  label: string;
  kind: 'photo' | 'postcard' | 'signature' | 'thumb' | 'declaration';
  liveCapture: boolean;
  width?: number;
  height?: number;
  widthCm?: number;
  heightCm?: number;
  dpi?: number;
  sizeIsSuggested: boolean;
  autoMaxEdge?: number;
  minWidth?: number;
  minHeight?: number;
  minKb: number;
  maxKb?: number;
  fit: 'cover' | 'contain';
  caption: 'none' | 'optional' | 'required';
  notes: string[];
}

interface Props {
  examName: string;
  documents: ExamDocument[];
}

export function describeSize(d: ExamDocument): string {
  const parts: string[] = [];
  if (d.width && d.height && !d.sizeIsSuggested) parts.push(`${d.width} × ${d.height} px`);
  if (d.widthCm && d.heightCm) parts.push(`${d.widthCm} × ${d.heightCm} cm`);
  if (d.minWidth && d.minHeight) parts.push(`at least ${d.minWidth} × ${d.minHeight} px`);
  return parts.join(', ');
}

export function describeKb(d: ExamDocument): string {
  if (!d.maxKb) return '';
  return d.minKb > 0 ? `${d.minKb}–${d.maxKb} KB` : `up to ${d.maxKb} KB`;
}

export default function ExamTool({ examName, documents }: Props) {
  const firstUpload = documents.findIndex((d) => !d.liveCapture);
  const [active, setActive] = useState(firstUpload >= 0 ? firstUpload : 0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % documents.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + documents.length) % documents.length;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={`${examName} documents`} class="-mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0">
        {documents.map((d, i) => (
          <button
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`tab-${d.id}`}
            aria-selected={i === active}
            aria-controls={`panel-${d.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            class={`-mb-px flex min-h-[52px] shrink-0 flex-col justify-center border-b-[3px] px-3 text-left ${
              i === active ? 'border-stamp text-ink' : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            <span class="text-[0.98rem] font-bold">{d.label}</span>
            <span class="tabular text-xs text-ink-3">{d.liveCapture ? 'Live camera photo' : describeKb(d)}</span>
          </button>
        ))}
      </div>
      {documents.map((d, i) => (
        <div role="tabpanel" id={`panel-${d.id}`} aria-labelledby={`tab-${d.id}`} hidden={i !== active} class="pt-6">
          {d.liveCapture ? <LivePanel doc={d} /> : <DocPanel doc={d} examName={examName} />}
        </div>
      ))}
    </div>
  );
}

function LivePanel({ doc }: { doc: ExamDocument }) {
  return (
    <div class="max-w-[64ch] rounded-[14px] border border-rule bg-sheet p-5">
      <h3 class="text-[1.15rem] font-bold text-ink">No upload needed for the {doc.label.toLowerCase()}</h3>
      <ul class="mt-3 list-disc space-y-1.5 pl-5 text-ink-2">
        {doc.notes.map((n) => (
          <li>{n}</li>
        ))}
      </ul>
    </div>
  );
}

interface Spec {
  minKb: number;
  maxKb: number;
  width?: number;
  height?: number;
}

function DocPanel({ doc, examName }: { doc: ExamDocument; examName: string }) {
  const { loaded, loading, error: loadError, load } = useImage();
  const isPaper = doc.fit === 'contain';
  const [clean, setClean] = useState(isPaper);
  const [withCaption, setWithCaption] = useState(doc.caption === 'required');
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => {
    const t = new Date();
    return `${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}`;
  });
  const [custom, setCustom] = useState(false);
  const [spec, setSpec] = useState<Spec>({ minKb: doc.minKb, maxKb: doc.maxKb!, width: doc.width, height: doc.height });
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EncodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const resultUrl = useBlobUrl(result?.blob ?? null);

  const active: Spec = custom ? spec : { minKb: doc.minKb, maxKb: doc.maxKb!, width: doc.width, height: doc.height };
  const fixedSize = !!(active.width && active.height);
  const showCaption = withCaption && doc.kind !== 'signature' && doc.kind !== 'thumb' && doc.kind !== 'declaration';
  const captionData = showCaption ? { name, date } : null;
  const aspect = fixedSize ? photoAspect(active.width!, active.height!, showCaption) : 1;
  const needsCrop = !!loaded && doc.fit === 'cover' && fixedSize;
  const specValid = active.maxKb > 0 && active.minKb < active.maxKb && (!active.width || active.width > 0) && (!active.height || active.height > 0);

  useEffect(() => {
    if (!loaded || !specValid || (needsCrop && !crop)) return;
    const id = ++run.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const frame = await renderImage(loaded.bitmap, {
          width: active.width,
          height: active.height,
          autoMaxEdge: fixedSize ? undefined : doc.autoMaxEdge ?? 800,
          crop: needsCrop ? crop! : undefined,
          fit: doc.fit,
          cleanPaper: isPaper && clean,
          caption: captionData,
        });
        const target = targetBytesFor({ minKb: active.minKb, maxKb: active.maxKb });
        const out = await compressInWorker(frame, target, {
          // Exact sizes must stay exact; suggested or automatic sizes may shrink.
          allowDownscale: !fixedSize || (doc.sizeIsSuggested && !custom),
          initialScale: 1,
          dpi: doc.dpi,
        });
        if (id !== run.current) return;
        setResult(out);
      } catch (e) {
        if (id !== run.current) return;
        setResult(null);
        setError(
          e instanceof TooBigError
            ? `This can't get below ${formatBytes(e.smallestBytes)} at the required size. Try a plainer background or better light.`
            : 'Something went wrong. Try again, or use a different photo.',
        );
      } finally {
        if (id === run.current) setBusy(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, crop, clean, showCaption, name, date, custom, spec, specValid, needsCrop]);

  const checks: Check[] = [];
  if (result) {
    const t = targetBytesFor({ minKb: active.minKb, maxKb: active.maxKb });
    const size = result.blob.size;
    checks.push({
      label: 'File size',
      value: `${formatBytes(size)} (allowed ${active.minKb > 0 ? `${active.minKb}–${active.maxKb}` : `up to ${active.maxKb}`} KB)`,
      ok: size >= t.min && size <= t.max,
    });
    if (fixedSize && !(doc.sizeIsSuggested && !custom)) {
      checks.push({
        label: 'Dimensions',
        value: `${result.width} × ${result.height} px`,
        ok: result.width === active.width && result.height === active.height,
      });
    } else if (doc.minWidth && doc.minHeight) {
      checks.push({
        label: 'Dimensions',
        value: `${result.width} × ${result.height} px (at least ${doc.minWidth} × ${doc.minHeight})`,
        ok: result.width >= doc.minWidth && result.height >= doc.minHeight,
      });
    } else {
      checks.push({ label: 'Dimensions', value: `${result.width} × ${result.height} px`, ok: null });
    }
    checks.push({ label: 'Format', value: 'JPG', ok: true });
    if (doc.dpi) checks.push({ label: 'Resolution', value: `${doc.dpi} DPI`, ok: true });
  }

  const notes: string[] = [];
  if (result?.padded) {
    notes.push(`The clean image was smaller than ${active.minKb} KB, so invisible padding was added inside the file to meet the minimum. It looks exactly the same.`);
  }

  const kbText = active.minKb > 0 ? `${active.minKb}–${active.maxKb} KB` : `${active.maxKb} KB`;

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 space-y-5">
        {!loaded ? (
          <>
            <Dropzone
              onFiles={(f) => load(f[0])}
              label={`Choose ${doc.label.toLowerCase()}`}
              hint={isPaper ? 'A clear phone photo of the paper works. We trim the edges and whiten the paper.' : 'Any recent photo works. You can position it in the next step.'}
            />
            {loading && <p class="text-ink-2" role="status">Opening your file…</p>}
            {loadError && <p class="font-semibold text-fail" role="alert">{loadError}</p>}
          </>
        ) : (
          <>
            {needsCrop && (
              <div class="rounded-[14px] border border-rule bg-sheet p-4">
                <p class="mb-3 text-sm font-semibold text-ink-2">Fit your face inside the guide</p>
                <CropBox
                  src={loaded.url}
                  imgW={loaded.bitmap.width}
                  imgH={loaded.bitmap.height}
                  aspect={aspect}
                  onChange={setCrop}
                  resetKey={`${loaded.url}|${aspect.toFixed(4)}`}
                />
              </div>
            )}
            <ResultCard
              original={{ url: loaded.url, bytes: loaded.file.size, w: loaded.bitmap.width, h: loaded.bitmap.height }}
              result={result && resultUrl ? { url: resultUrl, bytes: result.blob.size, w: result.width, h: result.height } : null}
              busy={busy}
              busyText={`Fitting it to ${kbText}…`}
              error={!specValid ? 'Check the custom size: the maximum KB must be above the minimum.' : error}
              stamp={{ title: `Ready for ${examName}`, sub: formatBytes(result?.blob.size ?? 0) }}
              checks={checks}
              notes={notes}
              downloadLabel={`Download ${doc.label.toLowerCase()}`}
              onDownload={() => result && downloadBlob(result.blob, `${doc.id}.jpg`)}
            />
            <Dropzone compact onFiles={(f) => load(f[0])} />
          </>
        )}
      </div>

      <aside class="h-fit space-y-5 rounded-[14px] border border-rule bg-sheet p-5">
        <div>
          <h3 class="font-bold text-ink">{doc.label} rules</h3>
          <dl class="mt-2 divide-y divide-rule border-y border-rule text-[0.95rem]">
            <div class="flex justify-between gap-3 py-2">
              <dt class="text-ink-2">File size</dt>
              <dd class="tabular text-right font-semibold">{describeKb(doc)}</dd>
            </div>
            {describeSize(doc) && (
              <div class="flex justify-between gap-3 py-2">
                <dt class="text-ink-2">Size</dt>
                <dd class="tabular text-right font-semibold">{describeSize(doc)}</dd>
              </div>
            )}
            {doc.dpi && (
              <div class="flex justify-between gap-3 py-2">
                <dt class="text-ink-2">Resolution</dt>
                <dd class="tabular text-right font-semibold">{doc.dpi} DPI</dd>
              </div>
            )}
            <div class="flex justify-between gap-3 py-2">
              <dt class="text-ink-2">Format</dt>
              <dd class="text-right font-semibold">JPG</dd>
            </div>
          </dl>
          {doc.notes.length > 0 && (
            <ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {doc.notes.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          )}
        </div>

        {isPaper && (
          <label class="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={clean} onChange={(e) => setClean((e.currentTarget as HTMLInputElement).checked)} />
            <span class="text-[0.95rem]">
              Whiten the paper and trim the edges
              <span class="block text-sm text-ink-3">Fixes grey or yellow phone photos of paper.</span>
            </span>
          </label>
        )}

        {doc.caption !== 'none' && (
          <div>
            <label class="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]"
                checked={withCaption}
                disabled={doc.caption === 'required'}
                onChange={(e) => setWithCaption((e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="text-[0.95rem]">
                Add name and date below the photo
                <span class="block text-sm text-ink-3">Only if your notification asks for it.</span>
              </span>
            </label>
            {withCaption && (
              <div class="mt-2 space-y-3 pl-8">
                <label class="block">
                  <span class="text-sm font-semibold text-ink-2">Name</span>
                  <input class="blank mt-1" value={name} autoComplete="name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="block">
                  <span class="text-sm font-semibold text-ink-2">Date the photo was taken</span>
                  <input class="blank mt-1" value={date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
                </label>
              </div>
            )}
          </div>
        )}

        <div class="border-t border-rule pt-4">
          <label class="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={custom} onChange={(e) => setCustom((e.currentTarget as HTMLInputElement).checked)} />
            <span class="text-[0.95rem]">
              My notification says something different
              <span class="block text-sm text-ink-3">Enter the size from your notification.</span>
            </span>
          </label>
          {custom && (
            <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 pl-8">
              <NumField label="Min KB" value={spec.minKb} onChange={(v) => setSpec({ ...spec, minKb: v ?? 0 })} />
              <NumField label="Max KB" value={spec.maxKb} onChange={(v) => setSpec({ ...spec, maxKb: v ?? 0 })} />
              {doc.fit === 'cover' || doc.width ? (
                <>
                  <NumField label="Width px" value={spec.width} onChange={(v) => setSpec({ ...spec, width: v })} />
                  <NumField label="Height px" value={spec.height} onChange={(v) => setSpec({ ...spec, height: v })} />
                </>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <label class="block">
      <span class="text-sm font-semibold text-ink-2">{label}</span>
      <input
        class="blank mt-1"
        inputMode="decimal"
        value={value ?? ''}
        onInput={(e) => {
          const raw = (e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, '');
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}
