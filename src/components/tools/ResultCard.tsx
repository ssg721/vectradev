import { formatBytes } from '../../lib/bytes';

export interface Check {
  label: string;
  value: string;
  /** true = meets the rule, false = fails it, 'warn' = worth a look (doesn't block), null = information only */
  ok: boolean | 'warn' | null;
}

export interface Preview {
  url: string;
  bytes: number;
  w: number;
  h: number;
  /** Replaces the default "size, W × H px" caption (e.g. for PDFs). */
  caption?: string;
}

interface Props {
  original: Preview;
  result: Preview | null;
  busy: boolean;
  busyText?: string;
  error?: string | null;
  stamp?: { title: string; sub: string } | null;
  checks?: Check[];
  notes?: string[];
  downloadLabel?: string;
  onDownload?: () => void;
  /** File to offer through the phone's share sheet (WhatsApp, Drive…), when supported. */
  shareFile?: File | null;
}

function Mark({ ok }: { ok: Check['ok'] }) {
  if (ok === 'warn')
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-label="Worth checking" class="shrink-0 text-warn">
        <path d="M10 3l8 14H2L10 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        <path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    );
  if (ok === null) return <span aria-hidden="true" class="inline-block w-5 text-center text-ink-3">·</span>;
  return ok ? (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-label="Meets the rule" class="shrink-0 text-pass">
      <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-label="Does not meet the rule" class="shrink-0 text-fail">
      <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  );
}

function Pane({ title, p, children }: { title: string; p: Preview | null; children?: preact.ComponentChildren }) {
  return (
    <figure class="flex min-w-0 flex-col">
      <div class="preview-bg relative flex h-[230px] items-center justify-center overflow-hidden rounded-[10px] border border-rule sm:h-[280px]">
        {p && p.url && <img src={p.url} alt={title} class="h-full w-full object-contain p-2" />}
        {children}
      </div>
      <figcaption class="mt-2 flex items-baseline justify-between gap-2 text-sm">
        <span class="font-semibold text-ink">{title}</span>
        {p && (
          <span class="tabular text-ink-2">
            {p.caption ?? `${formatBytes(p.bytes)}, ${p.w} × ${p.h} px`}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

export default function ResultCard({
  original,
  result,
  busy,
  busyText = 'Finding the best quality…',
  error,
  stamp,
  checks = [],
  notes = [],
  downloadLabel = 'Download',
  onDownload,
  shareFile,
}: Props) {
  const canShare =
    !!shareFile && typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [shareFile] });
  const saved = result && original.bytes > 0 ? 1 - result.bytes / original.bytes : 0;
  const allOk = checks.length > 0 && checks.every((c) => c.ok !== false);

  return (
    <div class="rounded-[14px] border border-rule bg-sheet p-4 sm:p-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <Pane title="Original" p={original} />
        <Pane title="Result" p={busy ? null : result}>
          {busy && (
            <div class="flex flex-col items-center gap-3 text-ink-2" role="status" aria-live="polite">
              <span class="h-8 w-8 animate-spin rounded-full border-[3px] border-rule border-t-stamp motion-reduce:animate-none" />
              <span class="text-sm">{busyText}</span>
            </div>
          )}
          {!busy && error && (
            <p class="px-6 text-center text-[0.95rem] font-semibold text-fail" role="alert">
              {error}
            </p>
          )}
          {!busy && !error && result && stamp && allOk && (
            <div class="stamp stamp-in absolute right-3 bottom-3" role="status">
              {stamp.title}
              <small>{stamp.sub}</small>
            </div>
          )}
        </Pane>
      </div>

      {!busy && !error && result && (
        <>
          {checks.length > 0 && (
            <ul class="mt-5 divide-y divide-rule border-y border-rule" aria-label="Requirement checks">
              {checks.map((c) => (
                <li class={`flex min-h-[44px] items-center gap-3 py-2 text-[0.95rem] ${c.ok === 'warn' ? 'text-warn' : ''}`}>
                  <Mark ok={c.ok} />
                  <span class="w-28 shrink-0 text-ink-2 sm:w-36">{c.label}</span>
                  <span class={`tabular font-semibold ${c.ok === 'warn' ? 'text-warn' : 'text-ink'}`}>{c.value}</span>
                </li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <ul class="mt-3 space-y-1 text-sm text-ink-2">
              {notes.map((n) => (
                <li>{n}</li>
              ))}
            </ul>
          )}
          <div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" class="btn btn-primary min-w-[200px]" onClick={onDownload}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 2v10M4.5 7.5L9 12l4.5-4.5M3 16h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              {downloadLabel}
            </button>
            {canShare && (
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => navigator.share({ files: [shareFile!] }).catch(() => {})}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M9 11V2M5.5 5.5L9 2l3.5 3.5M4 9H3v7h12V9h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                Share
              </button>
            )}
            {saved > 0.01 && (
              <span class="tabular text-sm text-ink-2">{Math.round(saved * 100)}% smaller than the original</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
