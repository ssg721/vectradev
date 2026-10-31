/**
 * Exam presets live in src/data/exams/*.json — one file per exam.
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
    kind: z.enum(['photo', 'postcard', 'signature', 'thumb', 'declaration']),
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

const exams = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/data/exams' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    fullName: z.string(),
    covers: z.array(z.string()).default([]),
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
  }),
});

export const collections = { exams };
