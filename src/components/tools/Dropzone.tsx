import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  /** Main line inside the box. */
  label?: string;
  hint?: string;
  /** A smaller version, for "choose another" once a file is loaded. */
  compact?: boolean;
}

/**
 * The upload box, styled like the "affix photograph here" box on a printed form.
 * Supports tap/click, drag and drop, and pasting an image from the clipboard.
 */
export default function Dropzone({
  onFiles,
  accept = 'image/*,.heic,.heif',
  multiple = false,
  label = 'Choose a photo',
  hint = 'or drop it here. JPG, PNG, WebP or iPhone HEIC.',
  compact = false,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        onFiles(multiple ? files : files.slice(0, 1));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles, multiple]);

  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  if (compact) {
    return (
      <>
        <button type="button" class="btn btn-quiet" onClick={() => input.current?.click()}>
          {multiple ? 'Add more files' : 'Choose another file'}
        </button>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            take((e.currentTarget as HTMLInputElement).files);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </>
    );
  }

  return (
    <div
      class={`relative rounded-[14px] border-2 border-dashed transition-colors ${
        over ? 'border-stamp bg-stamp-soft' : 'border-rule-strong bg-sheet'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer?.files);
      }}
    >
      {/* Corner crop marks, like a photo box on a form */}
      {['left-3 top-3 border-l-2 border-t-2', 'right-3 top-3 border-r-2 border-t-2', 'left-3 bottom-3 border-l-2 border-b-2', 'right-3 bottom-3 border-r-2 border-b-2'].map((pos) => (
        <span aria-hidden="true" class={`pointer-events-none absolute h-4 w-4 border-ink-3 ${pos}`} />
      ))}
      <label class="flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" class="text-ink-3">
          <rect x="7" y="5" width="30" height="34" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
          <circle cx="22" cy="18" r="6" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M11 35c2-7 7-10 11-10s9 3 11 10" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
        <span class="btn btn-primary pointer-events-none">{label}</span>
        <span class="max-w-[34ch] text-[0.95rem] text-ink-2">{hint}</span>
        <span class="text-sm text-ink-3">Nothing is uploaded. Your file stays on this device.</span>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          class="sr-only"
          onChange={(e) => {
            take((e.currentTarget as HTMLInputElement).files);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </label>
    </div>
  );
}
