import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import directivesYaml from '../content/directives.yaml?raw';
import sourcesYaml from '../content/sources.yaml?raw';
import { parseVendor, type Vendor } from './catalogue/schema';
import type { SourceExpression } from './csp/model';

const Explanation = z.object({
  title: z.string(),
  simple: z.string(),
  developer: z.string(),
  security: z.string(),
});

const DirectiveDoc = Explanation.extend({ name: z.string() });
const SourceDoc = Explanation.extend({ id: z.string() });

export type Explanation = z.infer<typeof Explanation>;
export type DirectiveDoc = z.infer<typeof DirectiveDoc>;
export type SourceDoc = z.infer<typeof SourceDoc>;

/** Everything the analyzer needs to explain a policy; serializable so it can be passed to the island. */
export interface ContentBundle {
  directives: Record<string, DirectiveDoc>;
  sources: Record<string, SourceDoc>;
  vendors: Vendor[];
}

const byKey = <T, K extends keyof T>(items: T[], key: K) =>
  Object.fromEntries(items.map((i) => [String(i[key]), i])) as Record<string, T>;

const vendorFiles = import.meta.glob<string>('../../catalogue/vendors/*.yaml', { query: '?raw', import: 'default', eager: true });

/** Parsed and validated at build time: invalid content fails the build. */
export const content: ContentBundle = {
  directives: byKey(z.array(DirectiveDoc).parse(parseYaml(directivesYaml)), 'name'),
  sources: byKey(z.array(SourceDoc).parse(parseYaml(sourcesYaml)), 'id'),
  vendors: Object.values(vendorFiles)
    .map(parseVendor)
    .sort((a, b) => a.name.localeCompare(b.name)),
};

/** Which entry of sources.yaml explains a source expression. */
export function sourceDocId(expr: SourceExpression): string | undefined {
  switch (expr.kind) {
    case 'keyword':
      return expr.value;
    case 'nonce':
      return 'nonce';
    case 'hash':
      return 'hash';
    case 'scheme':
      return `scheme:${expr.value}`;
    case 'host':
      if (expr.host?.host === '*') return 'wildcard';
      if (expr.host?.host.startsWith('*.')) return 'wildcard-host';
      return 'host';
    default:
      return undefined;
  }
}

export function explainSource(bundle: Pick<ContentBundle, 'sources'>, expr: SourceExpression): SourceDoc | undefined {
  const id = sourceDocId(expr);
  if (!id) return undefined;
  return bundle.sources[id] ?? (expr.kind === 'scheme' ? bundle.sources.scheme : undefined);
}
