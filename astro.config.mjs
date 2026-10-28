import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import { META_DIRECTIVES } from './src/site-policy.ts';

export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [preact()],
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
