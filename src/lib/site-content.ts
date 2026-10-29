import type { Locale } from '../i18n';
import directives from '../content/directives.yaml?raw';
import sources from '../content/sources.yaml?raw';
import type { ContentBundle } from './content';
import { loadContent, type ContentFiles, type LocaleFiles } from './content-loader';

/** Astro's side of the content: the files through Vite, so the dev server reloads when they change. */
const glob = {
  vendors: import.meta.glob<string>('../../catalogue/vendors/*.yaml', { query: '?raw', import: 'default', eager: true }),
  content: import.meta.glob<string>('../content/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
  vendorTranslations: import.meta.glob<string>('../../catalogue/i18n/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
};

/** `…/<folder>/<name>.yaml` → [folder, name] */
const lastTwo = (path: string) => path.replace(/\.yaml$/, '').split('/').slice(-2) as [string, string];

const translations: Record<string, LocaleFiles> = {};
const localeFiles = (locale: string) => (translations[locale] ??= { vendors: {} });
for (const [path, text] of Object.entries(glob.content)) {
  const [locale, name] = lastTwo(path);
  if (name === 'directives' || name === 'sources') localeFiles(locale)[name] = text;
}
for (const [path, text] of Object.entries(glob.vendorTranslations)) {
  const [locale, id] = lastTwo(path);
  localeFiles(locale).vendors[id] = text;
}

const files: ContentFiles = {
  directives,
  sources,
  vendors: Object.fromEntries(Object.entries(glob.vendors).map(([path, text]) => [lastTwo(path)[1], text])),
  translations,
};

const cache = new Map<Locale, ContentBundle>();

/** Everything the pages and the analyzer show, in one language. Invalid English content fails the build. */
export function contentFor(locale: Locale): ContentBundle {
  let bundle = cache.get(locale);
  if (!bundle) cache.set(locale, (bundle = loadContent(files, locale).bundle));
  return bundle;
}
