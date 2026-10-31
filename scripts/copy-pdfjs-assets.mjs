// Copies the pdf.js files that are fetched on demand (CJK character maps,
// standard fonts, and WebAssembly decoders for JPEG 2000 / JBIG2 scans) into
// public/pdfjs, so they are served from this site. Runs before dev and build.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.warn('pdfjs-dist is not installed; skipping asset copy.');
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(src, dir), join(dest, dir), {
    recursive: true,
    // quickjs is only for running scripts embedded in PDFs, which we disable.
    filter: (p) => !/quickjs/.test(p),
  });
}
console.log('Copied pdf.js assets to public/pdfjs');
