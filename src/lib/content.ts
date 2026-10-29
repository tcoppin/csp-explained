import type { Vendor } from './catalogue/schema';
import type { SourceExpression } from './csp/model';

/**
 * The content types and the helpers the analyzer island uses. Parsing, validation and translations live in
 * `content-loader.ts` and run at build time only, so the browser never loads YAML or zod.
 */
export interface Explanation {
  title: string;
  simple: string;
  developer: string;
  security: string;
}

export interface DirectiveDoc extends Explanation {
  name: string;
}

export interface SourceDoc extends Explanation {
  id: string;
}

/** Everything the analyzer needs to explain a policy, in one language; serializable so it can be passed to the island. */
export interface ContentBundle {
  directives: Record<string, DirectiveDoc>;
  sources: Record<string, SourceDoc>;
  vendors: Vendor[];
}

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
