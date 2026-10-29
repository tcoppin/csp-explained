import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ContentFiles, LocaleFiles } from '../src/lib/content-loader';

export const ROOT = join(import.meta.dirname, '..');

const yamlFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort() : []);
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** The same files Astro reads through Vite (`src/lib/site-content.ts`), from disk. */
export function readContentFiles(root = ROOT): ContentFiles {
  const content = join(root, 'src', 'content');
  const vendors = join(root, 'catalogue', 'vendors');
  const vendorTranslations = join(root, 'catalogue', 'i18n');

  const translations: Record<string, LocaleFiles> = {};
  for (const locale of new Set([...folders(content), ...folders(vendorTranslations)])) {
    const dir = join(vendorTranslations, locale);
    translations[locale] = {
      directives: read(join(content, locale, 'directives.yaml')),
      sources: read(join(content, locale, 'sources.yaml')),
      vendors: Object.fromEntries(yamlFiles(dir).map((f) => [basename(f, '.yaml'), readFileSync(join(dir, f), 'utf8')])),
    };
  }

  return {
    directives: readFileSync(join(content, 'directives.yaml'), 'utf8'),
    sources: readFileSync(join(content, 'sources.yaml'), 'utf8'),
    vendors: Object.fromEntries(yamlFiles(vendors).map((f) => [basename(f, '.yaml'), readFileSync(join(vendors, f), 'utf8')])),
    translations,
  };
}
