/**
 * Presets live in src/data/exams/*.json (exam forms) and
 * src/data/id-photos/*.json (passport and visa photos) — one file each.
 * The schema below is checked at build time: a typo like "20kb" instead of 20,
 * or a minimum above the maximum, stops the build instead of reaching users.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const document = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    label: z.string(),
    /** 'passport-page' is a photo of the passport's photo (data) page, as visa portals ask for. */
    kind: z.enum(['photo', 'postcard', 'signature', 'thumb', 'declaration', 'passport-page']),
    /** The portal captures this live with a camera, so there is nothing to upload. */
    liveCapture: z.boolean().default(false),
    /** Exact pixel size required by the portal. */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /** Physical size, shown to users and used when only cm are given. */
    widthCm: z.number().positive().optional(),
    heightCm: z.number().positive().optional(),
    dpi: z.number().int().positive().optional(),
    /** True when width/height are our sensible default, not a rule from the notification. */
    sizeIsSuggested: z.boolean().default(false),
    /** For trimmed documents with no fixed size: longest edge of the output, in pixels. */
    autoMaxEdge: z.number().int().positive().optional(),
    /** Minimum pixel size, when the rule is "at least W×H". */
    minWidth: z.number().int().positive().optional(),
    minHeight: z.number().int().positive().optional(),
    minKb: z.number().nonnegative().default(0),
    maxKb: z.number().positive().optional(),
    format: z.literal('jpg').default('jpg'),
    /** 'cover' = crop to fill (photos). 'contain' = trim paper and fit (signatures, thumbs). */
    fit: z.enum(['cover', 'contain']),
    /** Whether to offer the "name and date on photo" strip. */
    caption: z.enum(['none', 'optional', 'required']).default('none'),
    notes: z.array(z.string()).default([]),
  })
  .refine((d) => d.liveCapture || d.maxKb !== undefined, { message: 'Uploaded documents need maxKb' })
  .refine((d) => d.maxKb === undefined || d.minKb < d.maxKb, { message: 'minKb must be below maxKb' })
  .refine((d) => (d.width === undefined) === (d.height === undefined), { message: 'Give both width and height, or neither' })
  .refine((d) => (d.widthCm === undefined) === (d.heightCm === undefined), { message: 'Give both widthCm and heightCm, or neither' })
  .refine((d) => d.liveCapture || d.width !== undefined || d.autoMaxEdge !== undefined, {
    message: 'Uploaded documents need width/height or autoMaxEdge',
  })
  .refine((d) => d.fit === 'contain' || d.liveCapture || d.width !== undefined, { message: 'Cropped photos need width/height' });

const preset = z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    fullName: z.string(),
    covers: z.array(z.string()).default([]),
    /** Extra words people might search for ("bank", "railway"). */
    keywords: z.array(z.string()).default([]),
    order: z.number().int(),
    intro: z.string(),
    documents: z.array(document).min(1),
    source: z.object({
      label: z.string(),
      url: z.url(),
      official: z.boolean(),
    }),
    lastVerified: z.coerce.date(),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    /** Start with editable rules ("any other document"). */
    customStart: z.boolean().default(false),
    /** A hand-written answer for the size box under the heading; built from the documents when not set. */
    summary: z.string().optional(),
});

/** Plain-language travel guidance shown on visa pages, from the official sources. */
const travelGuide = z.object({
  /** The official place to apply. Look-alike sites charge extra, so this is always named. */
  portal: z.object({ label: z.string(), url: z.url() }),
  /** Short "at a glance" rows: who needs it, cost, stay, processing time. */
  facts: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
  steps: z.array(z.string()).min(1),
  /** Other things to do before flying (arrival cards, tourist levies…). */
  beforeYouFly: z.array(z.string()).default([]),
  /** Extra sources behind the guide (the photo rules use `source`). */
  sources: z.array(z.object({ label: z.string(), url: z.url() })).default([]),
});

const idPhotoPreset = preset.extend({
  /** Passports and visas are listed separately on the hub. */
  category: z.enum(['passport', 'visa']).default('visa'),
  /** Empty when the country needs no photo (the page is then a guide only). */
  documents: z.array(document).default([]),
  travel: travelGuide.optional(),
  /** Overrides for pages whose title isn't "<name> photo resizer". */
  seo: z
    .object({ title: z.string(), metaTitle: z.string(), description: z.string(), lede: z.string() })
    .optional(),
});

const exams = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/data/exams' }),
  schema: preset,
});

const idPhotos = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/data/id-photos' }),
  schema: idPhotoPreset,
});

export const collections = { exams, idPhotos };
