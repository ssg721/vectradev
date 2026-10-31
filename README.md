# vectradev.in

Free photo tools that run entirely in the browser: compress to any KB, exam photo and signature resizer (IBPS, SBI, SSC, RRB, UPSC, NEET, JEE), image resizer, and JPG/PNG/WebP/HEIC converter. Nothing is uploaded.

Built with Astro + Preact + Tailwind. Image encoding uses MozJPEG and libwebp compiled to WebAssembly (jSquash), running in a Web Worker.

## Run it locally

Requires Node.js 22.23.4 or newer (Node 24 LTS recommended; see `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # engine unit tests
npm run check      # type check
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
```

## Deploy to Cloudflare Pages (free)

1. Push this folder to a GitHub repository.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repository.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `24`
4. Deploy. You get a `*.pages.dev` URL to test on your phone.
5. **Custom domain:** in the Pages project, open **Custom domains → Set up a domain** and enter `vectradev.in` (and `www.vectradev.in`).
   - Easiest: move the domain's nameservers to Cloudflare (add the site in Cloudflare, then change the nameservers at your registrar). Cloudflare then creates the DNS records for you.
   - Or keep your registrar's DNS and add the CNAME record Cloudflare shows you.

`public/_headers` sets security headers and long caching for built assets. Cloudflare Pages serves `/exam.html` at `/exam` automatically.

## After launch

- **Google Search Console:** add `vectradev.in` as a domain property, verify via DNS, then submit `https://vectradev.in/sitemap-index.xml`.
- **Analytics:** turn on Cloudflare Web Analytics for the site, then set `PUBLIC_CF_ANALYTICS_TOKEN` in the Pages environment variables and redeploy.
- **AdSense:** apply once the site has been live and indexed for a few weeks. After approval, set:
  - `PUBLIC_ADSENSE_CLIENT` = `ca-pub-XXXXXXXXXXXXXXXX`
  - `PUBLIC_ADSENSE_SLOT` = your display ad unit's slot id

  Then redeploy. Ad slots appear between sections only, never beside upload or download buttons. Also add an `ads.txt` file to `public/` with the line AdSense gives you.

## Updating exam sizes

Each exam is one JSON file in `src/data/exams/`. To change a rule, edit the numbers, update `lastVerified` and `source`, and redeploy.

```jsonc
{
  "id": "signature", "label": "Signature", "kind": "signature",
  "width": 140, "height": 60, "dpi": 200,   // exact pixels from the notification
  "minKb": 10, "maxKb": 20,                 // KB range
  "fit": "contain"                          // "cover" = crop (photos), "contain" = trim and fit (signatures, thumbs)
}
```

The build checks every file against the schema in `src/content.config.ts`. A typo like `"20kb"` instead of `20`, or a minimum above the maximum, stops the build instead of reaching users.

To add an exam, copy an existing file, give it a new `slug` and `order`, and fill in its documents. Its page, the hub table, footer links and sitemap entry are generated automatically.

Use `"liveCapture": true` for documents the portal captures with the camera (SSC and RRB photos), and `"sizeIsSuggested": true` when the notification gives only a KB range and the pixel size is our default.

## How the size targeting works

`src/lib/compress.ts` binary-searches JPEG quality to land inside the allowed range:

- Upper limits are checked with 1 KB = 1000 bytes, lower limits with 1 KB = 1024 bytes, so files pass whichever way a portal counts.
- It aims for the middle of a range, and at least 10% above any minimum.
- When resizing is allowed, it adjusts pixel size to keep quality in a good band instead of producing a tiny q95 image or a huge blocky one.
- If a clean image is still below a minimum (common for small signatures), it adds a JPEG comment block. The picture is unchanged and every viewer ignores it.
- DPI is written into the JFIF header (`src/lib/jpeg-meta.ts`).

## Project layout

```
src/
  data/exams/*.json        exam presets (one per exam)
  content.config.ts        preset schema, checked at build time
  lib/                     engine: compress search, JPEG metadata, worker, rendering, image loading
  components/tools/        interactive tools (Preact)
  layouts/                 page frames (Base, ToolPage, TextPage)
  pages/                   routes; [conversion].astro and compress-image-to-[size].astro generate several pages each
public/                    favicon, icons, share image, robots.txt, _headers
```

## Not in this version yet

PDF tools (merge, split, compress, JPG↔PDF), SVG tools, offline support, and PAN card presets (sources disagreed on the PAN photo dimensions, so it was left out rather than shipped wrong).
