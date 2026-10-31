/**
 * ads.txt, generated from PUBLIC_ADSENSE_CLIENT (e.g. "ca-pub-1234567890123456").
 * Lists Google as an authorised seller of this site's ad space.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const client = (import.meta.env.PUBLIC_ADSENSE_CLIENT ?? '').trim();
  const pub = client.replace(/^ca-/, '');
  const body = /^pub-\d{10,}$/.test(pub)
    ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
    : '# No ad sellers configured.\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
