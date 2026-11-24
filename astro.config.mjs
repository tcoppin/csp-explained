import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/config.ts';
import { META_DIRECTIVES } from './src/site-policy.ts';

/** `https://site/learn/` → `https://site/learn`, as the site links to its pages. */
const noSlash = (url) => url.replace(/(?<=.)\/$/, '');

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'ignore',
  // Stylesheets go inside each page: a separate file blocks the first paint until it arrives. On Lighthouse's mobile
  // profile (slow 4G) the first paint went from ~440 ms to ~230 ms, for 3–6 KB more HTML per page (gzipped).
  // Our CSP allows them through the hashes Astro adds to style-src.
  build: { format: 'directory', inlineStylesheets: 'always' },
  // Sitemap addresses match the site's links (no trailing slash), with each page's other languages;
  // the 404 page isn't one to index.
  integrations: [
    preact(),
    sitemap({
      filter: (page) => !page.includes('/404'),
      i18n: { defaultLocale: 'en', locales: { en: 'en', fr: 'fr' } },
      serialize: (item) => ({
        ...item,
        url: noSlash(item.url),
        links: item.links?.map((link) => ({ ...link, url: noSlash(link.url) })),
      }),
    }),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
  },
  // Our own policy: see src/site-policy.ts. Only applied by `astro build`, not in dev.
  security: {
    csp: {
      directives: META_DIRECTIVES,
    },
  },
});
