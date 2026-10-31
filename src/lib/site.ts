export const SITE = {
  name: 'vectradev',
  url: 'https://vectradev.in',
  /** Shown under the logo and in the home page title. */
  tagline: 'Form-ready photos and PDFs, made on your device',
  email: 'hello@vectradev.in',
  /** Public source code, linked so people can check the privacy claims themselves. */
  repo: 'https://github.com/ssg721/vectradev',
  /** AdSense publisher ID. Public by design (it appears in every page's HTML). Can be overridden with PUBLIC_ADSENSE_CLIENT. */
  adsenseClient: (import.meta.env.PUBLIC_ADSENSE_CLIENT as string | undefined)?.trim() || 'ca-pub-4857783926140389',
};

export interface ToolLink {
  href: string;
  title: string;
  blurb: string;
}

export const KB_PRESETS = [10, 20, 50, 100, 200, 500] as const;

export const COMPRESS_TOOLS: ToolLink[] = [
  { href: '/compress-image-to-kb', title: 'Compress image to any KB', blurb: 'Type a size limit and get a JPG under it.' },
  ...KB_PRESETS.map((kb) => ({
    href: `/compress-image-to-${kb}kb`,
    title: `Compress image to ${kb} KB`,
    blurb: kb <= 20 ? 'For signatures and small form uploads.' : kb <= 100 ? 'For photos on most online forms.' : 'For documents and clearer photos.',
  })),
];

export interface Conversion {
  slug: string;
  from: string;
  to: 'jpeg' | 'png' | 'webp';
  fromLabel: string;
  toLabel: string;
  accept: string;
  why: string;
}

export const CONVERSIONS: Conversion[] = [
  {
    slug: 'heic-to-jpg', from: 'heic', to: 'jpeg', fromLabel: 'HEIC', toLabel: 'JPG',
    accept: '.heic,.heif,image/heic,image/heif',
    why: 'iPhones save photos as HEIC, which most websites and Windows apps cannot open. JPG works everywhere.',
  },
  {
    slug: 'webp-to-jpg', from: 'webp', to: 'jpeg', fromLabel: 'WebP', toLabel: 'JPG',
    accept: '.webp,image/webp',
    why: 'Images saved from websites are often WebP, which many forms and older apps reject.',
  },
  {
    slug: 'png-to-jpg', from: 'png', to: 'jpeg', fromLabel: 'PNG', toLabel: 'JPG',
    accept: '.png,image/png',
    why: 'Screenshots and scans saved as PNG are large. JPG is usually several times smaller and accepted by every form.',
  },
  {
    slug: 'jpg-to-png', from: 'jpeg', to: 'png', fromLabel: 'JPG', toLabel: 'PNG',
    accept: '.jpg,.jpeg,image/jpeg',
    why: 'PNG keeps every pixel exactly, which is useful for editing or when a site asks specifically for PNG.',
  },
  {
    slug: 'jpg-to-webp', from: 'jpeg', to: 'webp', fromLabel: 'JPG', toLabel: 'WebP',
    accept: '.jpg,.jpeg,image/jpeg',
    why: 'WebP images are typically 25–35% smaller than JPG at the same quality, so web pages load faster.',
  },
  {
    slug: 'webp-to-png', from: 'webp', to: 'png', fromLabel: 'WebP', toLabel: 'PNG',
    accept: '.webp,image/webp',
    why: 'Turn a WebP into a PNG that every image editor can open, without losing quality.',
  },
];

export const IMAGE_TOOLS: ToolLink[] = [
  { href: '/image-resizer', title: 'Image resizer', blurb: 'Set exact pixels or centimetres, with DPI.' },
  { href: '/image-converter', title: 'Image converter', blurb: 'Convert between JPG, PNG and WebP, including iPhone HEIC.' },
  ...CONVERSIONS.map((c) => ({ href: `/${c.slug}`, title: `${c.fromLabel} to ${c.toLabel}`, blurb: c.why.split('. ')[0] + '.' })),
];

/** "Compress PDF to …" landing pages. */
export const PDF_KB_PRESETS = [100, 200, 500, 1000] as const;

export function pdfPresetSlug(kb: number): string {
  return kb >= 1000 && kb % 1000 === 0 ? `${kb / 1000}mb` : `${kb}kb`;
}

export function pdfPresetLabel(kb: number): string {
  return kb >= 1000 && kb % 1000 === 0 ? `${kb / 1000} MB` : `${kb} KB`;
}

export const PDF_TOOLS: ToolLink[] = [
  { href: '/compress-pdf', title: 'Compress PDF', blurb: 'Make a PDF smaller by quality, or under a size limit.' },
  ...PDF_KB_PRESETS.map((kb) => ({
    href: `/compress-pdf-to-${pdfPresetSlug(kb)}`,
    title: `Compress PDF to ${pdfPresetLabel(kb)}`,
    blurb: kb <= 200 ? 'For certificates and documents on exam and job forms.' : 'For email attachments and application portals.',
  })),
];

/** Top menu groups. `short` is shown on phones so all four fit; `match` decides which group is highlighted. */
export const NAV = [
  {
    href: '/image-tools',
    label: 'Image tools',
    short: 'Images',
    match: (p: string) => p === '/image-tools' || [...COMPRESS_TOOLS, ...IMAGE_TOOLS].some((t) => t.href === p),
  },
  { href: '/pdf-tools', label: 'PDF tools', short: 'PDFs', match: (p: string) => p === '/pdf-tools' || PDF_TOOLS.some((t) => t.href === p) },
  { href: '/passport-visa-photo', label: 'Passport & visa', short: 'Passport & visa', match: (p: string) => p.startsWith('/passport-visa-photo') },
  { href: '/exam', label: 'Exam photos', short: 'Exams', match: (p: string) => p === '/exam' || p.startsWith('/exam/') },
];
