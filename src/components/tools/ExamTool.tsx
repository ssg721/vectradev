import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import CropBox from './CropBox';
import ResultCard, { type Check } from './ResultCard';
import { useBlobUrl, useImage } from './useImage';
import { photoAspect, quickChecks, renderImage, rotateBitmap, type QuickCheck, type Rect } from '../../lib/render';
import { compressInWorker, TooBigError, type EncodedImage, warmUp } from '../../lib/codec';
import { formatBytes, targetBytesFor } from '../../lib/bytes';
import { downloadBlob } from '../../lib/image';

type DocResult = { blob: Blob; ok: boolean } | null;

/** Mirrors the document schema in src/content.config.ts. */
export interface ExamDocument {
  id: string;
  label: string;
  kind: 'photo' | 'postcard' | 'signature' | 'thumb' | 'declaration' | 'passport-page';
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
  /** What the rules come from, used in "My notification says something different". */
  ruleSource?: string;
  /** Start with editable rules (for "any other document"). */
  customStart?: boolean;
}

export function describeSize(d: ExamDocument): string {
  const parts: string[] = [];
  if (d.width && d.height && !d.sizeIsSuggested) parts.push(`${d.width} × ${d.height} px`);
  if (d.widthCm && d.heightCm) parts.push(`${d.widthCm} × ${d.heightCm} cm`);
  if (d.minWidth && d.minHeight) parts.push(`at least ${d.minWidth} × ${d.minHeight} px`);
  return parts.join(', ');
}

/** 10000 → "10 MB"; 250 → "250 KB". */
const kbText = (kb: number) => (kb >= 1000 && kb % 1000 === 0 ? `${kb / 1000} MB` : `${kb} KB`);

export function describeKb(d: ExamDocument): string {
  if (!d.maxKb) return '';
  if (!(d.minKb > 0)) return `up to ${kbText(d.maxKb)}`;
  const max = kbText(d.maxKb);
  return max.endsWith(' KB') ? `${d.minKb}–${d.maxKb} KB` : `${kbText(d.minKb)} to ${max}`;
}

export default function ExamTool({ examName, documents, ruleSource = 'notification', customStart = false }: Props) {
  const firstUpload = documents.findIndex((d) => !d.liveCapture);
  const [active, setActive] = useState(firstUpload >= 0 ? firstUpload : 0);
  const [results, setResults] = useState<Record<string, DocResult>>({});
  const [zipping, setZipping] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const uploads = documents.filter((d) => !d.liveCapture);
  const ready = uploads.filter((d) => results[d.id]?.ok);

  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % documents.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + documents.length) % documents.length;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  const goTo = (i: number) => {
    setActive(i);
    tabs.current[i]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    tabs.current[i]?.focus({ preventScroll: true });
  };

  /** The next document (after `i`) that still needs a file, wrapping around. */
  const nextPending = (i: number) => {
    for (let k = 1; k < documents.length; k++) {
      const j = (i + k) % documents.length;
      if (!documents[j].liveCapture && !results[documents[j].id]?.ok) return j;
    }
    return -1;
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const { zipSync } = await import('fflate');
      const entries: import('fflate').Zippable = {};
      for (const d of ready) entries[`${d.id}.jpg`] = [new Uint8Array(await results[d.id]!.blob.arrayBuffer()), { level: 0 }];
      const name = `${examName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-documents.zip`;
      downloadBlob(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), name);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={`${examName} documents`}
        hidden={documents.length < 2}
        class="-mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0"
      >
        {documents.map((d, i) => {
          const r = results[d.id];
          return (
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
              class={`-mb-px flex min-h-[56px] shrink-0 items-center gap-2 border-b-[3px] px-3 text-left ${
                i === active ? 'border-stamp text-ink' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              {!d.liveCapture && (
                <span
                  aria-hidden="true"
                  class={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    r?.ok ? 'border-pass bg-pass text-paper' : 'border-rule-strong'
                  }`}
                >
                  {r?.ok && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.5 6.5l2.2 2.2L9.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  )}
                </span>
              )}
              <span class="flex flex-col">
                <span class="text-[0.98rem] font-bold">{d.label}</span>
                <span class={`tabular text-xs ${r?.ok ? 'text-pass' : 'text-ink-3'}`}>
                  {d.liveCapture ? 'Live camera photo' : r?.ok ? `Ready, ${formatBytes(r.blob.size)}` : describeKb(d)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {uploads.length > 1 && ready.length > 0 && (
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule py-3" aria-live="polite">
          <p class="text-[0.95rem] text-ink-2">
            <strong class="tabular text-ink">
              {ready.length} of {uploads.length}
            </strong>{' '}
            documents ready
            {ready.length === uploads.length && <span class="text-pass">. All set for {examName}.</span>}
          </p>
          <button type="button" class="btn btn-quiet min-h-[44px] px-4 text-[0.95rem]" disabled={ready.length === 0 || zipping} onClick={downloadAll}>
            {zipping ? 'Preparing…' : ready.length > 1 ? `Download all ${ready.length} (ZIP)` : 'Download all (ZIP)'}
          </button>
        </div>
      )}

      {documents.map((d, i) => {
        const n = nextPending(i);
        return (
          <div role="tabpanel" id={`panel-${d.id}`} aria-labelledby={`tab-${d.id}`} hidden={i !== active} class="pt-6">
            {d.liveCapture ? (
              <LivePanel doc={d} />
            ) : (
              <DocPanel
                doc={d}
                examName={examName}
                ruleSource={ruleSource}
                customStart={customStart}
                onResult={(r) => setResults((prev) => (prev[d.id] === r ? prev : { ...prev, [d.id]: r }))}
                next={n >= 0 && n !== i ? { label: documents[n].label, go: () => goTo(n) } : null}
              />
            )}
          </div>
        );
      })}
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
  /** Size in `unit`; converted to pixels with `dpi` when the unit is mm. */
  w?: number;
  h?: number;
  unit: 'px' | 'mm';
  dpi: number;
}

function specPixels(s: Spec): { width?: number; height?: number } {
  if (!s.w || !s.h) return {};
  if (s.unit === 'px') return { width: Math.round(s.w), height: Math.round(s.h) };
  return { width: Math.round((s.w / 25.4) * s.dpi), height: Math.round((s.h / 25.4) * s.dpi) };
}

interface DocPanelProps {
  doc: ExamDocument;
  examName: string;
  ruleSource: string;
  customStart: boolean;
  onResult: (r: DocResult) => void;
  next: { label: string; go: () => void } | null;
}

function DocPanel({ doc, examName, ruleSource, customStart, onResult, next }: DocPanelProps) {
  const { loaded, loading, error: loadError, load } = useImage();
  const isPaper = doc.fit === 'contain';
  /** A photo of the passport's photo page: framed and resized, but no face or paper checks. */
  const isScan = doc.kind === 'passport-page';
  const [clean, setClean] = useState(isPaper);
  const [withCaption, setWithCaption] = useState(doc.caption === 'required');
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => {
    const t = new Date();
    return `${String(t.getDate()).padStart(2, '0')}-${String(t.getMonth() + 1).padStart(2, '0')}-${t.getFullYear()}`;
  });
  const [custom, setCustom] = useState(customStart);
  const [spec, setSpec] = useState<Spec>(() =>
    (customStart || !doc.width) && doc.widthCm && doc.heightCm && doc.dpi
      ? { minKb: doc.minKb, maxKb: doc.maxKb!, w: doc.widthCm * 10, h: doc.heightCm * 10, unit: 'mm', dpi: doc.dpi }
      : { minKb: doc.minKb, maxKb: doc.maxKb!, w: doc.width, h: doc.height, unit: 'px', dpi: doc.dpi ?? 300 },
  );
  const [crop, setCrop] = useState<Rect | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [inkStrength, setInkStrength] = useState(50);
  const [work, setWork] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [qchecks, setQchecks] = useState<QuickCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EncodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const resultUrl = useBlobUrl(result?.blob ?? null);
  useEffect(() => warmUp(), []);

  // A new file starts with no rotation or adjustments.
  useEffect(() => {
    setRotation(0);
    setBrightness(0);
    setContrast(0);
    setInkStrength(50);
  }, [loaded]);

  // The rotated working copy that the crop box and renderer use.
  useEffect(() => {
    if (!loaded) {
      setWork(null);
      return;
    }
    if (rotation === 0) {
      setWork({ bitmap: loaded.bitmap, url: loaded.url });
      return;
    }
    let cancelled = false;
    let made: { bitmap: ImageBitmap; url: string } | null = null;
    (async () => {
      const bitmap = await rotateBitmap(loaded.bitmap, rotation);
      const c = document.createElement('canvas');
      const s = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      c.width = Math.round(bitmap.width * s);
      c.height = Math.round(bitmap.height * s);
      c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.85));
      made = { bitmap, url: URL.createObjectURL(blob) };
      if (!cancelled) setWork(made);
    })();
    return () => {
      cancelled = true;
      if (made) {
        made.bitmap.close();
        URL.revokeObjectURL(made.url);
      }
    };
  }, [loaded, rotation]);

  // Tell the checklist above whether this document is ready.
  useEffect(() => {
    onResult(result ? { blob: result.blob, ok: hardChecksPass } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const active = custom
    ? { minKb: spec.minKb, maxKb: spec.maxKb, ...specPixels(spec), dpi: spec.dpi }
    : { minKb: doc.minKb, maxKb: doc.maxKb!, width: doc.width, height: doc.height, dpi: doc.dpi };
  const fixedSize = !!(active.width && active.height);
  const showCaption = withCaption && doc.kind !== 'signature' && doc.kind !== 'thumb' && doc.kind !== 'declaration' && !isScan;
  const captionData = showCaption ? { name, date } : null;
  const aspect = fixedSize ? photoAspect(active.width!, active.height!, showCaption) : 1;
  const needsCrop = !!work && doc.fit === 'cover' && fixedSize;
  const specValid = active.maxKb > 0 && active.minKb < active.maxKb && (!active.width || (active.width > 0 && active.width <= 8000)) && (!active.height || (active.height > 0 && active.height <= 8000));

  useEffect(() => {
    if (!work || !specValid || (needsCrop && !crop)) return;
    const id = ++run.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const frame = await renderImage(work.bitmap, {
          width: active.width,
          height: active.height,
          autoMaxEdge: fixedSize ? undefined : doc.autoMaxEdge ?? 800,
          crop: needsCrop ? crop! : undefined,
          fit: doc.fit,
          cleanPaper: isPaper && clean,
          inkStrength,
          brightness: isPaper ? 0 : brightness,
          contrast: isPaper ? 0 : contrast,
          caption: captionData,
        });
        // Checks run on the finished picture, before it is handed to the encoder.
        const qc = isScan ? [] : await quickChecks(frame, isPaper ? 'paper' : 'photo', showCaption ? 1 - 0.18 : 1);
        const target = targetBytesFor({ minKb: active.minKb, maxKb: active.maxKb });
        const out = await compressInWorker(frame, target, {
          // Exact sizes must stay exact; suggested or automatic sizes may shrink.
          allowDownscale: !fixedSize || (doc.sizeIsSuggested && !custom),
          initialScale: 1,
          dpi: active.dpi,
        });
        if (id !== run.current) return;
        setQchecks(qc);
        setResult(out);
      } catch (e) {
        if (id !== run.current) return;
        setResult(null);
        setQchecks([]);
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
  }, [work, crop, clean, showCaption, name, date, custom, spec, specValid, needsCrop, brightness, contrast, inkStrength]);

  const checks: Check[] = [];
  if (result) {
    const t = targetBytesFor({ minKb: active.minKb, maxKb: active.maxKb });
    const size = result.blob.size;
    checks.push({
      label: 'File size',
      value: `${formatBytes(size)} (allowed ${describeKb(active as ExamDocument)})`,
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
    if (active.dpi) checks.push({ label: 'Resolution', value: `${active.dpi} DPI`, ok: true });
  }

  const hardChecksPass = checks.length > 0 && checks.every((c) => c.ok !== false);
  for (const q of qchecks) checks.push(q);

  const notes: string[] = [];
  if (result?.padded) {
    notes.push(`The clean image was smaller than ${active.minKb} KB, so invisible padding was added inside the file to meet the minimum. It looks exactly the same.`);
  }

  const kbText = describeKb(active as ExamDocument).replace(/^up to /, '');

  // The rules as short chips, shown before anything is uploaded.
  const chips: string[] = [kbText];
  if (active.width && active.height) {
    chips.push(doc.sizeIsSuggested && !custom ? `about ${active.width} × ${active.height} px` : `${active.width} × ${active.height} px`);
  } else if (doc.minWidth && doc.minHeight) chips.push(`at least ${doc.minWidth} × ${doc.minHeight} px`);
  if (active.dpi) chips.push(`${active.dpi} DPI`);
  chips.push('JPG');

  const shareFile = result ? new File([result.blob], `${doc.id}.jpg`, { type: 'image/jpeg' }) : null;
  const isReady = !!result && !busy && hardChecksPass;

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 space-y-5">
        <ul class="flex flex-wrap gap-2" aria-label={`${doc.label} requirements`}>
          {chips.map((c) => (
            <li class="tabular rounded-full border border-rule-strong bg-sheet px-3 py-1 text-sm font-semibold text-ink">{c}</li>
          ))}
        </ul>
        {!loaded ? (
          <>
            <Dropzone
              onFiles={(f) => load(f[0])}
              camera="environment"
              cameraLabel={isScan ? 'Photograph your passport page' : isPaper ? `Photograph your ${doc.kind === 'thumb' ? 'thumb impression' : doc.kind}` : 'Take a photo'}
              label={`Choose ${doc.label.toLowerCase()}`}
              hint={
                isScan
                  ? 'Lay your passport open and flat in daylight, and photograph the photo page from straight above. You can line it up in the next step.'
                  : isPaper
                    ? 'A clear phone photo of the paper works. We trim the edges and whiten the paper.'
                    : 'Any recent photo works. You can position it in the next step.'
              }
            />
            {loading && <p class="text-ink-2" role="status">Opening your file…</p>}
            {loadError && <p class="font-semibold text-fail" role="alert">{loadError}</p>}
          </>
        ) : (
          <>
            <div class="rounded-[14px] border border-rule bg-sheet p-4">
              {needsCrop && work && (
                <>
                  <p class="mb-3 text-sm font-semibold text-ink-2">
                    {isScan ? 'Line up the whole photo page inside the frame, including the two lines of letters at the bottom' : 'Fit your face inside the guide'}
                  </p>
                  <CropBox
                    src={work.url}
                    imgW={work.bitmap.width}
                    imgH={work.bitmap.height}
                    aspect={aspect}
                    onChange={setCrop}
                    resetKey={`${work.url}|${aspect.toFixed(4)}`}
                  />
                </>
              )}
              <div class={`flex flex-wrap items-end gap-x-6 gap-y-3 ${needsCrop ? 'mt-4 border-t border-rule pt-4' : ''}`}>
                <button
                  type="button"
                  class="btn btn-quiet min-h-[44px] px-3 text-[0.95rem]"
                  onClick={() => setRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270))}
                  aria-label="Rotate 90 degrees clockwise"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M14 7a5.5 5.5 0 10.6 4.5M14 2.5V7H9.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  Rotate
                </button>
                {isPaper ? (
                  clean && <Slider label="Ink darkness" value={inkStrength} min={0} max={100} onChange={setInkStrength} />
                ) : (
                  <>
                    <Slider label="Brightness" value={brightness} min={-60} max={60} onChange={setBrightness} />
                    <Slider label="Contrast" value={contrast} min={-60} max={60} onChange={setContrast} />
                  </>
                )}
              </div>
            </div>
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
              shareFile={shareFile}
            />
            <div class="flex flex-wrap items-center gap-3">
              {isReady && next && (
                <button type="button" class="btn btn-primary" onClick={next.go}>
                  Next: {next.label}
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              )}
              <Dropzone compact onFiles={(f) => load(f[0])} />
            </div>
          </>
        )}
      </div>

      <aside class="h-fit space-y-5 rounded-[14px] border border-rule bg-sheet p-5">
        {customStart ? (
          <div>
            <h3 class="font-bold text-ink">Your document's photo rules</h3>
            <p class="mt-1 text-sm text-ink-3">Copy these from the official instructions for your application.</p>
            <CustomFields spec={spec} setSpec={setSpec} sized />
            {doc.notes.length > 0 && (
              <ul class="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-2">
                {doc.notes.map((n) => (
                  <li>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
        <div>
          <h3 class="font-bold text-ink">Tips for your {doc.label.toLowerCase()}</h3>
          {doc.notes.length > 0 && (
            <ul class="mt-2 list-disc space-y-1.5 pl-5 text-[0.95rem] text-ink-2">
              {doc.notes.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          )}
          <p class="mt-3 text-sm text-ink-3">
            {isScan
              ? 'We check the size, pixels and format automatically. Make sure every letter on the page is sharp and readable before you download.'
              : `We check the size, pixels and format, plus ${isPaper ? 'that the ink is clear' : 'the background and lighting'}, automatically.`}
          </p>
        </div>
        )}

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
                <span class="block text-sm text-ink-3">Only if your {ruleSource} asks for it.</span>
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

        {!customStart && (
          <div class="border-t border-rule pt-4">
            <label class="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={custom} onChange={(e) => setCustom((e.currentTarget as HTMLInputElement).checked)} />
              <span class="text-[0.95rem]">
                My {ruleSource} says something different
                <span class="block text-sm text-ink-3">Enter the size from your {ruleSource}.</span>
              </span>
            </label>
            {custom && (
              <div class="pl-8">
                <CustomFields spec={spec} setSpec={setSpec} sized={doc.fit === 'cover' || !!doc.width} />
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function CustomFields({ spec, setSpec, sized }: { spec: Spec; setSpec: (s: Spec) => void; sized: boolean }) {
  const px = specPixels(spec);
  return (
    <div class="mt-3 space-y-3">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <NumField label="Min KB" value={spec.minKb} onChange={(v) => setSpec({ ...spec, minKb: v ?? 0 })} />
        <NumField label="Max KB" value={spec.maxKb} onChange={(v) => setSpec({ ...spec, maxKb: v ?? 0 })} />
      </div>
      {sized && (
        <>
          <div class="flex gap-2" role="group" aria-label="Size unit">
            {(['px', 'mm'] as const).map((u) => (
              <button
                type="button"
                class="chip"
                aria-pressed={spec.unit === u}
                onClick={() => {
                  if (u === spec.unit) return;
                  const toMm = (v?: number) => (v ? Math.round((v / spec.dpi) * 25.4 * 10) / 10 : v);
                  const p = specPixels(spec);
                  setSpec(u === 'mm' ? { ...spec, unit: u, w: toMm(spec.w), h: toMm(spec.h) } : { ...spec, unit: u, w: p.width, h: p.height });
                }}
              >
                {u === 'px' ? 'Pixels' : 'mm'}
              </button>
            ))}
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <NumField label={`Width ${spec.unit}`} value={spec.w} onChange={(v) => setSpec({ ...spec, w: v })} />
            <NumField label={`Height ${spec.unit}`} value={spec.h} onChange={(v) => setSpec({ ...spec, h: v })} />
            <NumField label="DPI" value={spec.dpi} onChange={(v) => setSpec({ ...spec, dpi: v && v > 0 ? v : 300 })} />
            {spec.unit === 'mm' && px.width && px.height && (
              <p class="tabular self-end pb-1 text-sm text-ink-3">
                = {px.width} × {px.height} px
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A number input that keeps what the user typed (so "3." can become "3.5"). */
function NumField({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  const [raw, setRaw] = useState(value === undefined ? '' : String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only sync from outside (e.g. switching px/mm) while the user isn't typing in this field.
    if (document.activeElement === input.current) return;
    setRaw(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <label class="block">
      <span class="text-sm font-semibold text-ink-2">{label}</span>
      <input
        ref={input}
        class="blank mt-1"
        inputMode="decimal"
        value={raw}
        onInput={(e) => {
          const next = (e.currentTarget as HTMLInputElement).value.replace(/[^\d.]/g, '');
          setRaw(next);
          const n = parseFloat(next);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
    </label>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label class="flex min-w-[150px] flex-1 flex-col gap-1">
      <span class="flex items-baseline justify-between text-sm font-semibold text-ink-2">
        {label}
        <span class="tabular text-ink-3">{value > 0 && min < 0 ? `+${value}` : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        class="w-full accent-[var(--stamp)]"
        onInput={(e) => onChange(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
        onDblClick={() => onChange(min < 0 ? 0 : 50)}
      />
    </label>
  );
}
