export const SITE = {
  name: 'vectradev',
  url: 'https://vectradev.in',
  /** Shown under the logo. Becomes "Form-ready photos and PDFs, made on your device" once PDF tools exist. */
  tagline: 'Form-ready photos, made on your device',
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
