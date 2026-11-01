/**
 * Where ads may appear, and which AdSense ad unit fills each place.
 *
 * - band:   full-width, between the tool and the guide (and between home page sections)
 * - rail:   a 300 px column beside the guide and FAQ, on wide screens only
 * - inline: between the guide and the FAQ, on phones and tablets (where there is no rail)
 *
 * Ads never appear inside a tool, above it, or next to upload and download buttons.
 * A place shows nothing until an ad unit id is set, except while developing
 * (or with PUBLIC_AD_PREVIEW=1), when a labelled placeholder shows where it will go.
 */
import { SITE } from './site';

export type AdPlacement = 'band' | 'rail' | 'inline';

const env = import.meta.env;
const main = (env.PUBLIC_ADSENSE_SLOT as string | undefined)?.trim() || '';
const side = (env.PUBLIC_ADSENSE_SLOT_SIDE as string | undefined)?.trim() || '';

export const AD_PREVIEW = !!env.DEV || env.PUBLIC_AD_PREVIEW === '1';

/** The ad unit id for a placement; the rail falls back to the main unit. */
export function adSlotFor(placement: AdPlacement): string {
  if (!SITE.adsenseClient) return '';
  return placement === 'rail' ? side || main : main;
}

/** Whether a placement renders anything (a real ad or a preview box). */
export function showsAd(placement: AdPlacement): boolean {
  return !!adSlotFor(placement) || AD_PREVIEW;
}
