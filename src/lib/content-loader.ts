import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { VendorSchema } from './catalogue/schema';
import type { ContentBundle } from './content';

/** Parses and validates the YAML content. Build time only (Astro pages, tests): the browser gets the result. */

/** The raw files, as read by Astro (`import.meta.glob`). */
export interface ContentFiles {
  directives: string;
  sources: string;
  /** By vendor id (the file name). */
  vendors: Record<string, string>;
}

const Explanation = z.object({ title: z.string(), simple: z.string(), developer: z.string(), security: z.string() });
const DirectiveDoc = Explanation.extend({ name: z.string() });
const SourceDoc = Explanation.extend({ id: z.string() });

const byKey = <T>(items: T[], keyOf: (item: T) => string) => Object.fromEntries(items.map((i) => [keyOf(i), i])) as Record<string, T>;

/** Invalid content throws, which fails the build. */
export function loadContent(files: ContentFiles): ContentBundle {
  return {
    directives: byKey(z.array(DirectiveDoc).parse(parseYaml(files.directives)), (d) => d.name),
    sources: byKey(z.array(SourceDoc).parse(parseYaml(files.sources)), (d) => d.id),
    vendors: Object.values(files.vendors)
      .map((text) => VendorSchema.parse(parseYaml(text)))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
