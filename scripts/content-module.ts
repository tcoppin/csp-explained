import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { loadContent } from '../src/lib/content-loader';
import { readContentFiles, ROOT } from './content-files';

const PREFIX = 'virtual:content/';

/** Every YAML file the content is built from, so the dev server reloads the module when one changes. */
function contentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((f) => f.isFile() && f.name.endsWith('.yaml'))
    .map((f) => join(f.parentPath, f.name));
}

/**
 * `virtual:content/<locale>`: what the islands show (directives, sources, the vendor catalogue), as a plain JS
 * module. The islands import it through their per-language entry (`Analyzer.en.tsx`…) instead of getting it as a
 * prop: a prop is written into every page's HTML (240 KB on the home page), the module is a fingerprinted file the
 * browser caches once for every page. Only JSON reaches the browser: the YAML and zod stay here.
 */
export function contentModule(): Plugin {
  return {
    name: 'csp-explained:content',
    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : undefined;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return undefined;
      const locale = id.slice(PREFIX.length + 1);
      for (const file of [...contentFiles(join(ROOT, 'src', 'content')), ...contentFiles(join(ROOT, 'catalogue'))]) this.addWatchFile(file);
      // Invalid English content throws, which fails the build as contentFor() does for the pages.
      const { bundle } = loadContent(readContentFiles(), locale);
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(bundle))});`;
    },
  };
}
