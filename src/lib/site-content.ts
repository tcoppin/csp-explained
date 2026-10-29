import type { Locale } from '../i18n';
import directives from '../content/directives.yaml?raw';
import sources from '../content/sources.yaml?raw';
import type { ContentBundle } from './content';
import { loadContent, type ContentFiles } from './content-loader';

/** Astro's side of the content: the files through Vite, so the dev server reloads when they change. */
const vendorFiles = import.meta.glob<string>('../../catalogue/vendors/*.yaml', { query: '?raw', import: 'default', eager: true });

const files: ContentFiles = {
  directives,
  sources,
  vendors: Object.fromEntries(Object.entries(vendorFiles).map(([path, text]) => [path.replace(/^.*\/|\.yaml$/g, ''), text])),
};

const cache = new Map<Locale, ContentBundle>();

/** Everything the pages and the analyzer show, in one language (English only for now). Invalid content fails the build. */
export function contentFor(locale: Locale): ContentBundle {
  let bundle = cache.get(locale);
  if (!bundle) cache.set(locale, (bundle = loadContent(files)));
  return bundle;
}
