import type { APIRoute } from 'astro';
import { SITE_URL } from '../config';

/** Everything may be indexed; `/e` only counts usage (see src/usage.ts). */
export const GET: APIRoute = () =>
  new Response(['User-agent: *', 'Disallow: /e?', '', `Sitemap: ${SITE_URL}/sitemap-index.xml`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
