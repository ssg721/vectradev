import { useEffect, useRef, useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import { warmUp } from '../../lib/codec';
import { formatBytes, maxBytesFor } from '../../lib/bytes';
import { baseName, downloadBlob, loadImage } from '../../lib/image';
import { imagesToPdf, PdfError, type ImagesToPdfResult, type PageSize, type PdfPresetName } from '../../lib/pdf';

type Rotation = 0 | 90 | 180 | 270;

interface Item {
  id: number;
  file: File;
  rotation: Rotation;
  /** Small preview; null while it's being made. */
  thumb: string | null;
  error?: string;
}

const ACCEPT = 'image/*,.heic,.heif';
const MAX_ITEMS = 300;
const QUICK_KB = [200, 500, 1000, 2000];
const PRESET_LABEL: Record<PdfPresetName, string> = { smallest: 'Smallest file', balanced: 'Balanced', quality: 'Best quality' };
const SIZE_LABEL: Record<PageSize, string> = { a4: 'A4', letter: 'Letter', fit: 'Same as image' };

let nextId = 1;

async function makeThumb(file: File): Promise<string> {
  const { bitmap } = await loadImage(file);
  const k = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('thumb'))), 'image/jpeg', 0.8));
  return URL.createObjectURL(blob);
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: preact.ComponentChildren }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      class="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink-2 hover:bg-paper hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

const arrow = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

export default function ImagesToPdfTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [margin, setMargin] = useState(false);
  const [mode, setMode] = useState<'preset' | 'size'>('preset');
  const [preset, setPreset] = useState<PdfPresetName>('balanced');
  const [maxKbText, setMaxKbText] = useState('500');
  const [grayscale, setGrayscale] = useState(false);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ImagesToPdfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [isPhone, setIsPhone] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const thumbing = useRef(false);
  const live = useRef<Item[]>([]);
  live.current = items;

  useEffect(() => {
    // Links from the PDF size pages pass the limit, e.g. /images-to-pdf?max=500
    const max = Number(new URLSearchParams(window.location.search).get('max'));
    if (max > 0 && max <= 100000) {
      setMode('size');
      setMaxKbText(String(max));
    }
    warmUp();
    setIsPhone(window.matchMedia('(pointer: coarse)').matches);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    (idle ?? ((cb: () => void) => setTimeout(cb, 500)))(() => {
      import('pdf-lib').catch(() => {});
    });
    return () => live.current.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
  }, []);

  // Make previews one at a time, so adding 50 photos doesn't freeze a phone.
  useEffect(() => {
    if (thumbing.current) return;
    const next = items.find((it) => it.thumb === null && !it.error);
    if (!next) return;
    thumbing.current = true;
    makeThumb(next.file)
      .then((url) => {
        if (live.current.some((it) => it.id === next.id)) setItems((list) => list.map((it) => (it.id === next.id ? { ...it, thumb: url } : it)));
        else URL.revokeObjectURL(url);
      })
      .catch(() => setItems((list) => list.map((it) => (it.id === next.id ? { ...it, error: "Can't open this file" } : it))))
      .finally(() => {
        thumbing.current = false;
        setItems((list) => [...list]); // look for the next one
      });
  }, [items]);

  // Any change to pages or settings means the last PDF is out of date.
  const orderKey = items.map((it) => `${it.id}:${it.rotation}`).join(',');
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [orderKey, pageSize, margin, mode, preset, maxKbText, grayscale]);

  const add = (files: File[]) => {
    setNotice(null);
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = files.filter((f) => !pdfs.includes(f));
    const room = MAX_ITEMS - items.length;
    const taken = images.slice(0, Math.max(0, room));
    const msgs: string[] = [];
    if (pdfs.length) msgs.push(`${pdfs.length === 1 ? 'A PDF was' : `${pdfs.length} PDFs were`} skipped. Only images can be added here.`);
    if (images.length > taken.length) msgs.push(`Up to ${MAX_ITEMS} images fit in one PDF, so ${images.length - taken.length} were left out.`);
    if (msgs.length) setNotice(msgs.join(' '));
    if (!taken.length) return;
    setItems((list) => [...list, ...taken.map((file) => ({ id: nextId++, file, rotation: 0 as Rotation, thumb: null }))]);
    if (!fileName && items.length === 0) setFileName(taken.length === 1 ? baseName(taken[0].name) : 'document');
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((list) => {
      const next = [...list];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const remove = (id: number) => {
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      return list.filter((x) => x.id !== id);
    });
  };

  const rotate = (id: number) => setItems((list) => list.map((it) => (it.id === id ? { ...it, rotation: (((it.rotation + 90) % 360) as Rotation) } : it)));

  const sortByName = () =>
    setItems((list) => [...list].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })));

  const clearAll = () => {
    items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
    setItems([]);
    setFileName('');
    setNotice(null);
  };

  const maxKb = parseFloat(maxKbText);
  const broken = items.filter((it) => it.error).length;
  const ready = items.length > 0 && !broken && (mode === 'preset' || maxKb > 0);

  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await imagesToPdf(
        items.map((it) => ({ file: it.file, rotation: it.rotation })),
        {
          pageSize,
          margin,
          maxBytes: mode === 'size' ? maxBytesFor(maxKb) : undefined,
          preset,
          grayscale,
          onProgress: (n, total) => setProgress(`Adding page ${n} of ${total}…`),
        },
      );
      setResult(out);
    } catch (e) {
      console.error(e);
      setError(e instanceof PdfError ? e.message : 'Something went wrong while making the PDF. Try fewer images, or try again.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const outName = `${(fileName.trim() || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
  const outFile = result ? new File([result.blob], outName, { type: 'application/pdf' }) : null;
  const canShare = !!outFile && typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [outFile] });
  const fits = !!result && (mode !== 'size' || result.blob.size <= maxBytesFor(maxKb));

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0">
        {items.length === 0 ? (
          <>
            <Dropzone
              onFiles={add}
              multiple
              accept={ACCEPT}
              camera="environment"
              cameraLabel="Photograph a page"
              label="Choose images"
              hint="or drop them here. Pick several at once: JPG, PNG, WebP or iPhone HEIC."
            />
            {notice && <p class="mt-3 font-semibold text-fail" role="alert">{notice}</p>}
          </>
        ) : (
          <>
            <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p class="font-semibold text-ink">
                {items.length} {items.length === 1 ? 'page' : 'pages'}
                <span class="ml-2 text-sm font-normal text-ink-3">{isPhone ? 'Use the arrows to change the order.' : 'Drag or use the arrows to change the order.'}</span>
              </p>
              <div class="flex flex-wrap gap-2">
                {items.length > 1 && (
                  <button type="button" class="chip" onClick={sortByName}>
                    Sort by file name
                  </button>
                )}
                <button type="button" class="chip" onClick={clearAll}>
                  Remove all
                </button>
              </div>
            </div>

            <ol
              class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
              onDragOver={(e) => {
                if (dragId === null && e.dataTransfer?.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                if (dragId === null && e.dataTransfer?.files.length) {
                  e.preventDefault();
                  add(Array.from(e.dataTransfer.files));
                }
              }}
            >
              {items.map((it, i) => (
                <li
                  key={it.id}
                  draggable={!isPhone}
                  onDragStart={(e) => {
                    setDragId(it.id);
                    e.dataTransfer?.setData('text/plain', String(it.id));
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    setOverId(it.id);
                  }}
                  onDrop={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    move(items.findIndex((x) => x.id === dragId), i);
                    setDragId(null);
                    setOverId(null);
                  }}
                  class={`flex min-w-0 flex-col rounded-[12px] border bg-sheet transition-colors ${
                    it.error ? 'border-fail' : overId === it.id && dragId !== it.id ? 'border-stamp' : 'border-rule'
                  } ${dragId === it.id ? 'opacity-40' : ''} ${isPhone ? '' : 'cursor-grab'}`}
                >
                  <div class="preview-bg relative flex aspect-square items-center justify-center overflow-hidden rounded-t-[11px]">
                    {it.thumb ? (
                      <img
                        src={it.thumb}
                        alt={`Page ${i + 1}: ${it.file.name}`}
                        draggable={false}
                        class="h-full w-full object-contain p-2 transition-transform"
                        style={{ transform: `rotate(${it.rotation}deg)` }}
                      />
                    ) : it.error ? (
                      <span class="px-3 text-center text-sm font-semibold text-fail">{it.error}</span>
                    ) : (
                      <span class="text-sm text-ink-3">Loading…</span>
                    )}
                    <span class="tabular absolute top-2 left-2 rounded-full bg-ink px-2 py-0.5 text-[0.8rem] font-bold text-paper">{i + 1}</span>
                  </div>
                  <p class="truncate px-2.5 pt-1.5 text-[0.8rem] text-ink-3" title={it.file.name}>
                    {it.file.name}
                  </p>
                  <div class="flex items-center justify-between px-1 pb-1">
                    <IconButton label={`Move page ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                      {arrow('M11 4L6 9l5 5')}
                    </IconButton>
                    <IconButton label={`Rotate page ${i + 1}`} disabled={!!it.error} onClick={() => rotate(it.id)}>
                      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                        <path d="M14.5 9A5.5 5.5 0 113 6.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
                        <path d="M2.5 2.5v4h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </IconButton>
                    <IconButton label={`Remove page ${i + 1}`} onClick={() => remove(it.id)}>
                      {arrow('M5 5l8 8M13 5l-8 8')}
                    </IconButton>
                    <IconButton label={`Move page ${i + 1} later`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                      {arrow('M7 4l5 5-5 5')}
                    </IconButton>
                  </div>
                </li>
              ))}
            </ol>

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Dropzone compact multiple accept={ACCEPT} onFiles={add} />
              {isPhone && (
                <>
                  <button type="button" class="btn btn-quiet" onClick={() => cameraInput.current?.click()}>
                    Photograph a page
                  </button>
                  <input
                    ref={cameraInput}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    class="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => {
                      add(Array.from((e.currentTarget as HTMLInputElement).files ?? []));
                      (e.currentTarget as HTMLInputElement).value = '';
                    }}
                  />
                </>
              )}
            </div>
            {notice && <p class="mt-3 font-semibold text-fail" role="alert">{notice}</p>}

            <div class="mt-6 rounded-[14px] border border-rule bg-sheet p-5" aria-live="polite">
              {result ? (
                <div class="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p class="text-[1.15rem] font-bold text-ink">
                      {fits ? 'Your PDF is ready' : 'Over the limit'}
                    </p>
                    <p class="tabular text-ink-2">
                      {outName} · {formatBytes(result.blob.size)}
                      {mode === 'size' && ` of ${maxKb} KB`} · {result.pages} {result.pages === 1 ? 'page' : 'pages'}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-primary" onClick={() => downloadBlob(result.blob, outName)}>
                      Download PDF
                    </button>
                    {canShare && (
                      <button type="button" class="btn btn-quiet" onClick={() => navigator.share({ files: [outFile!] }).catch(() => {})}>
                        Share
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div class="flex flex-wrap items-center justify-between gap-4">
                  <p class="text-ink-2">
                    {busy
                      ? progress || 'Starting…'
                      : broken
                        ? `Remove the ${broken === 1 ? 'image' : `${broken} images`} that couldn't be opened.`
                        : mode === 'size' && !(maxKb > 0)
                          ? 'Enter the maximum size in KB.'
                          : `Pages go in the order shown, 1 to ${items.length}.`}
                  </p>
                  <button type="button" class="btn btn-primary" disabled={!ready || busy} onClick={create}>
                    {busy ? 'Making PDF…' : 'Make PDF'}
                  </button>
                </div>
              )}
              {error && (
                <p class="mt-3 font-semibold text-fail" role="alert">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <fieldset class="h-fit rounded-[14px] border border-rule bg-sheet p-5">
        <legend class="sr-only">PDF settings</legend>

        <p class="text-sm font-semibold text-ink-2">Page size</p>
        <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Page size">
          {(Object.keys(SIZE_LABEL) as PageSize[]).map((s) => (
            <button type="button" class="chip" aria-pressed={pageSize === s} onClick={() => setPageSize(s)}>
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>
        {pageSize !== 'fit' && (
          <label class="mt-3 flex min-h-[44px] cursor-pointer items-center gap-3">
            <input type="checkbox" class="h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={margin} onChange={(e) => setMargin((e.currentTarget as HTMLInputElement).checked)} />
            <span class="text-[0.95rem]">White border around each image</span>
          </label>
        )}

        <p class="mt-5 border-t border-rule pt-4 text-sm font-semibold text-ink-2">File size</p>
        <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="How to set the file size">
          <button type="button" class="chip" aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}>
            By quality
          </button>
          <button type="button" class="chip" aria-pressed={mode === 'size'} onClick={() => setMode('size')}>
            Under a size
          </button>
        </div>
        {mode === 'size' ? (
          <div class="mt-4">
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
          <div class="mt-3 space-y-1" role="radiogroup" aria-label="Quality">
            {(Object.keys(PRESET_LABEL) as PdfPresetName[]).map((p) => (
              <label class="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input type="radio" name="img-pdf-preset" class="h-5 w-5 accent-[var(--stamp)]" checked={preset === p} onChange={() => setPreset(p)} />
                <span class="text-[0.95rem]">{PRESET_LABEL[p]}</span>
              </label>
            ))}
          </div>
        )}

        <label class="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3">
          <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-[var(--stamp)]" checked={grayscale} onChange={(e) => setGrayscale((e.currentTarget as HTMLInputElement).checked)} />
          <span class="text-[0.95rem]">
            Black and white
            <span class="block text-sm text-ink-3">Cleans up photographed documents and makes the file smaller.</span>
          </span>
        </label>

        <label class="mt-5 block border-t border-rule pt-4">
          <span class="text-sm font-semibold text-ink-2">File name</span>
          <span class="mt-1 flex items-baseline gap-1">
            <input
              class="blank text-[1.1rem]"
              value={fileName}
              placeholder="document"
              onInput={(e) => setFileName((e.currentTarget as HTMLInputElement).value)}
            />
            <span class="text-ink-3">.pdf</span>
          </span>
        </label>
      </fieldset>
    </div>
  );
}
