import type { APIRoute } from 'astro';
import { LOCALES, type Locale } from '../../i18n';
import { contentFor } from '../../lib/site-content';

/**
 * The tools' texts in one language, for an IT message written in another language than the page's
 * (src/components/analyzer/vendor-texts.ts). Loaded only when a visitor picks that language, so the
 * home page doesn't carry every language's catalogue.
 */
export function getStaticPaths() {
  return LOCALES.map((locale) => ({ params: { locale } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(contentFor(params.locale as Locale).vendors), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
