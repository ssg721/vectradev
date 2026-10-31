import { useState } from 'preact/hooks';
import Dropzone from './Dropzone';
import { loadImage, UnsupportedFileError, baseName, extensionFor, downloadBlob } from '../../lib/image';
import { renderImage } from '../../lib/render';
import { encodeInWorker, type OutputFormat } from '../../lib/codec';
import { formatBytes } from '../../lib/bytes';

interface Props {
  /** Fixed target format, or omit to let the user choose. */
  to?: OutputFormat;
  accept?: string;
  fromLabel?: string;
}

interface Item {
  id: number;
  name: string;
  inBytes: number;
  status: 'waiting' | 'working' | 'done' | 'failed';
  out?: Blob;
  thumb?: string;
  error?: string;
}

const LABEL: Record<OutputFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };
let seq = 1;

export default function ConvertTool({ to, accept = 'image/*,.heic,.heif', fromLabel }: Props) {
  const [format, setFormat] = useState<OutputFormat>(to ?? 'jpeg');
  const [quality, setQuality] = useState(90);
  const [items, setItems] = useState<Item[]>([]);
  const [zipping, setZipping] = useState(false);

  const lossy = format !== 'png';
  const update = (id: number, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const convert = async (files: File[], fmt = format, q = quality) => {
    const queued = files.map((f) => ({ id: seq++, name: f.name, inBytes: f.size, status: 'waiting' as const, file: f }));
    setItems((list) => [...list, ...queued.map(({ file: _f, ...rest }) => rest)]);
    // One at a time keeps memory low on phones.
    for (const q0 of queued) {
      update(q0.id, { status: 'working' });
      try {
        const { bitmap } = await loadImage(q0.file);
        const frame = await renderImage(bitmap, {
          width: bitmap.width,
          height: bitmap.height,
          fit: 'cover',
          transparent: fmt !== 'jpeg',
        });
        bitmap.close();
        const out = await encodeInWorker(frame, fmt, q);
        update(q0.id, { status: 'done', out: out.blob, thumb: URL.createObjectURL(out.blob) });
      } catch (e) {
        update(q0.id, {
          status: 'failed',
          error: e instanceof UnsupportedFileError ? e.message : 'Could not convert this file.',
        });
      }
    }
  };

  const filename = (it: Item) => `${baseName(it.name)}.${extensionFor(it.out!.type)}`;
  const done = items.filter((i) => i.status === 'done');

  const downloadAll = async () => {
    setZipping(true);
    try {
      const { zipSync } = await import('fflate');
      const entries: import('fflate').Zippable = {};
      for (const it of done) {
        let name = filename(it);
        let n = 2;
        while (entries[name]) name = `${baseName(it.name)}-${n++}.${extensionFor(it.out!.type)}`;
        // Images are already compressed; storing them without deflate is faster and no bigger.
        entries[name] = [new Uint8Array(await it.out!.arrayBuffer()), { level: 0 }];
      }
      const zip = zipSync(entries);
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `converted-${LABEL[format].toLowerCase()}.zip`);
    } finally {
      setZipping(false);
    }
  };

  const clearAll = () => {
    items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
    setItems([]);
  };

  return (
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="min-w-0">
        {items.length === 0 ? (
          <Dropzone
            multiple
            accept={accept}
            onFiles={(f) => convert(f)}
            label={fromLabel ? `Choose ${fromLabel} files` : 'Choose images'}
            hint={`or drop them here. You can pick several at once; each becomes a ${LABEL[format]}.`}
          />
        ) : (
          <div class="rounded-[14px] border border-rule bg-sheet p-4 sm:p-5">
            <ul class="divide-y divide-rule" aria-live="polite">
              {items.map((it) => (
                <li class="flex min-h-[64px] items-center gap-3 py-2">
                  <div class="preview-bg h-12 w-12 shrink-0 overflow-hidden rounded-md border border-rule">
                    {it.thumb && <img src={it.thumb} alt="" class="h-full w-full object-cover" />}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold text-ink">{it.status === 'done' ? filename(it) : it.name}</p>
                    <p class="tabular text-sm text-ink-2">
                      {it.status === 'waiting' && 'Waiting…'}
                      {it.status === 'working' && 'Converting…'}
                      {it.status === 'done' && `${formatBytes(it.inBytes)} to ${formatBytes(it.out!.size)}`}
                      {it.status === 'failed' && <span class="text-fail">{it.error}</span>}
                    </p>
                  </div>
                  {it.status === 'done' && (
                    <button type="button" class="btn btn-quiet min-h-[44px] px-3 text-sm" onClick={() => downloadBlob(it.out!, filename(it))}>
                      Download
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              {done.length > 1 && (
                <button type="button" class="btn btn-primary" disabled={zipping} onClick={downloadAll}>
                  {zipping ? 'Preparing ZIP…' : `Download all ${done.length} as ZIP`}
                </button>
              )}
              <Dropzone compact multiple accept={accept} onFiles={(f) => convert(f)} />
              <button type="button" class="btn min-h-[44px] px-3 text-ink-2 underline" onClick={clearAll}>
                Clear list
              </button>
            </div>
          </div>
        )}
      </div>

      <fieldset class="h-fit rounded-[14px] border border-rule bg-sheet p-5">
        <legend class="sr-only">Conversion settings</legend>
        {!to && (
          <div class="mb-5">
            <p class="text-sm font-semibold text-ink-2">Convert to</p>
            <div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Output format">
              {(['jpeg', 'png', 'webp'] as OutputFormat[]).map((f) => (
                <button type="button" class="chip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {LABEL[f]}
                </button>
              ))}
            </div>
          </div>
        )}
        {to && (
          <p class="mb-4 text-[0.95rem] text-ink-2">
            Output: <strong class="text-ink">{LABEL[format]}</strong>
          </p>
        )}
        {lossy ? (
          <label class="block">
            <span class="flex items-baseline justify-between text-sm font-semibold text-ink-2">
              Quality <span class="tabular text-ink">{quality}</span>
            </span>
            <input
              type="range"
              min={40}
              max={100}
              value={quality}
              class="mt-2 w-full accent-[var(--stamp)]"
              onInput={(e) => setQuality(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
            />
            <span class="mt-1 block text-sm text-ink-3">90 looks the same as the original for almost every photo.</span>
          </label>
        ) : (
          <p class="text-sm text-ink-3">PNG is lossless: every pixel is kept exactly.</p>
        )}
        {format === 'jpeg' && <p class="mt-4 text-sm text-ink-3">JPG has no transparency, so transparent areas become white.</p>}
        {items.length > 0 && <p class="mt-4 text-sm text-ink-3">New settings apply to the next files you add.</p>}
      </fieldset>
    </div>
  );
}
