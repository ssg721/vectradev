import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rect } from '../../lib/render';

interface Props {
  src: string;
  imgW: number;
  imgH: number;
  /** Width / height of the frame. */
  aspect: number;
  onChange: (crop: Rect) => void;
  /** Bumped by the parent to recentre when the image or aspect changes. */
  resetKey: string;
}

/**
 * Drag the photo to position it inside a fixed frame; use the slider to zoom.
 * Reports the crop rectangle in source-image pixels.
 */
export default function CropBox({ src, imgW, imgH, aspect, onChange, resetKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [frameW, setFrameW] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.45 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const frameH = frameW / aspect;
  const base = Math.max(frameW / imgW, frameH / imgH);
  const scale = base * zoom;

  // Keep the frame fully covered by the image.
  const clamp = (c: { x: number; y: number }, s = scale) => {
    const hx = frameW / 2 / s / imgW;
    const hy = frameH / 2 / s / imgH;
    return {
      x: Math.min(1 - hx, Math.max(hx, c.x)),
      y: Math.min(1 - hy, Math.max(hy, c.y)),
    };
  };

  useEffect(() => {
    setZoom(1);
    setCenter({ x: 0.5, y: 0.45 });
  }, [resetKey]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const max = Math.min(el.clientWidth, 340);
      // Keep tall frames from overflowing small screens.
      const byHeight = Math.min(window.innerHeight * 0.55, 460) * aspect;
      setFrameW(Math.max(160, Math.min(max, byHeight)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  const c = clamp(center);
  useEffect(() => {
    const w = Math.min(imgW, Math.round(frameW / scale));
    const h = Math.min(imgH, Math.round(frameH / scale));
    onChange({
      x: Math.max(0, Math.min(imgW - w, Math.round(c.x * imgW - w / 2))),
      y: Math.max(0, Math.min(imgH - h, Math.round(c.y * imgH - h / 2))),
      w,
      h,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.x, c.y, scale, frameW, frameH, imgW, imgH]);

  const left = frameW / 2 - c.x * imgW * scale;
  const top = frameH / 2 - c.y * imgH * scale;

  const nudge = (dx: number, dy: number) =>
    setCenter((p) => clamp({ x: p.x + dx / (imgW * scale), y: p.y + dy / (imgH * scale) }));

  return (
    <div ref={box} class="w-full">
      <div
        class="relative mx-auto touch-none select-none overflow-hidden rounded-md bg-sheet outline outline-2 outline-offset-0 outline-ink"
        style={{ width: `${frameW}px`, height: `${frameH}px`, cursor: drag.current ? 'grabbing' : 'grab' }}
        role="application"
        aria-label="Photo position. Drag to move, or use the arrow keys."
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 20 : 5;
          if (e.key === 'ArrowLeft') nudge(step, 0);
          else if (e.key === 'ArrowRight') nudge(-step, 0);
          else if (e.key === 'ArrowUp') nudge(0, step);
          else if (e.key === 'ArrowDown') nudge(0, -step);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          drag.current = { id: d.id, x: e.clientX, y: e.clientY };
          setCenter((p) => clamp({ x: p.x - dx / (imgW * scale), y: p.y - dy / (imgH * scale) }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          class="pointer-events-none absolute max-w-none"
          style={{ left: `${left}px`, top: `${top}px`, width: `${imgW * scale}px`, height: `${imgH * scale}px` }}
        />
        {/* Face guide for portrait photos */}
        {aspect < 1 && (
          <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="50" cy="42" rx="24" ry="26" fill="none" stroke="white" stroke-opacity="0.85" stroke-width="0.8" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <label class="mx-auto mt-3 flex max-w-[340px] items-center gap-3 text-sm text-ink-2">
        Zoom
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          class="flex-1 accent-[var(--stamp)]"
          onInput={(e) => {
            const z = parseFloat((e.currentTarget as HTMLInputElement).value);
            setZoom(z);
            setCenter((p) => clamp(p, base * z));
          }}
        />
      </label>
      <p class="mt-1 text-center text-sm text-ink-3">Drag the photo to position it.</p>
    </div>
  );
}
