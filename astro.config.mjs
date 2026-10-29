import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import { SITE_URL } from './src/config.ts';
import { META_DIRECTIVES } from './src/site-policy.ts';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // Sitemap addresses match the site's links (no trailing slash); the 404 page isn't one to index.
  integrations: [
    preact(),
    sitemap({
      filter: (page) => !page.includes('/404'),
      serialize: (item) => ({ ...item, url: item.url.replace(/(?<=.)\/$/, '') }),
    }),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  // Our own policy: see src/site-policy.ts. Only applied by `astro build`, not in dev.
  security: {
    csp: {
      directives: META_DIRECTIVES,
    },
  },
});
