import { directiveInfo } from './directives';
import type { Directive, Policy } from './model';

/** First non-duplicate directive with this name, as the browser would use it. */
export function findDirective(policy: Policy, name: string): Directive | undefined {
  return policy.directives.find((d) => d.name === name && !d.duplicate);
}

export interface Resolution {
  /** The directive the browser checks for `requested`. */
  requested: string;
  /** The directive that actually applies, or undefined when nothing restricts it. */
  governing?: Directive;
  /** Directives skipped because they were absent, in order. */
  skipped: string[];
}

/**
 * Walks the fallback chain (e.g. script-src-elem → script-src → default-src)
 * and returns the directive that ends up governing `requested`.
 */
export function resolve(policy: Policy, requested: string): Resolution {
  const chain = [requested, ...(directiveInfo(requested)?.fallback ?? [])];
  const skipped: string[] = [];
  for (const name of chain) {
    const d = findDirective(policy, name);
    if (d) return { requested, governing: d, skipped };
    skipped.push(name);
  }
  return { requested, skipped };
}
