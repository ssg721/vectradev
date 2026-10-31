// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://vectradev.in',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [preact(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // The jSquash codecs load their .wasm files relative to their own module URL,
    // so they must not be pre-bundled by Vite in dev.
    optimizeDeps: { exclude: ['@jsquash/jpeg', '@jsquash/webp'] },
    worker: { format: 'es' },
    // heic2any (~1.3 MB) is its own chunk and only loads when someone opens an iPhone HEIC photo.
    build: { chunkSizeWarningLimit: 1500 },
  },
});
