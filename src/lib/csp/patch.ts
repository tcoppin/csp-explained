import type { RequirementResult } from './compat';
import { CANONICAL_DIRECTIVE } from './directives';
import { findDirective } from './fallback';
import type { Directive, ParseResult, Policy } from './model';

export interface DirectiveChange {
  directive: string;
  /** The directive does not exist yet and is created (copying `copiedFrom` values). */
  created: boolean;
  copiedFrom?: string;
  added: string[];
  /** `'none'` is dropped when a source is added to a `'none'` directive. */
  removedNone: boolean;
  before?: string;
  after: string;
}

export interface PolicyPatch {
  policyIndex: number;
  changes: DirectiveChange[];
  before: string;
  after: string;
}

interface Pending {
  created: boolean;
  copiedFrom?: string;
  base: string[];
  added: string[];
}

const valuesOf = (d: Directive) => d.values.map((v) => v.raw);

/**
 * Computes the smallest edit that makes every blocked requirement pass.
 * When only default-src applies, a dedicated directive is created (copying default-src)
 * instead of widening default-src for every resource type.
 */
export function buildPatches(parsed: ParseResult, results: RequirementResult[]): PolicyPatch[] {
  const perPolicy = new Map<number, Map<string, Pending>>();

  for (const r of results) {
    if (r.verdict !== 'blocked') continue;
    for (const check of r.checks) {
      if (check.match.verdict !== 'blocked' || !check.match.directive) continue;
      const policy = parsed.policies[check.policyIndex]!;
      const governing = check.match.directive;
      const canonical = CANONICAL_DIRECTIVE[r.requirement.type];

      let target = governing.name;
      let pending: Pending;
      const changes = perPolicy.get(check.policyIndex) ?? new Map<string, Pending>();

      if (governing.name === 'default-src' && canonical !== 'default-src') {
        target = canonical;
        pending = changes.get(target) ?? {
          created: findDirective(policy, target) === undefined,
          copiedFrom: 'default-src',
          base: valuesOf(governing),
          added: [],
        };
      } else {
        pending = changes.get(target) ?? { created: false, base: valuesOf(governing), added: [] };
      }

      const already = new Set([...pending.base, ...pending.added].map((v) => v.toLowerCase()));
      // Already listed but ignored (e.g. 'unsafe-inline' next to a nonce): adding it again would change nothing.
      if (already.has(r.requirement.source.toLowerCase())) continue;
      pending.added.push(r.requirement.source);
      changes.set(target, pending);
      perPolicy.set(check.policyIndex, changes);
    }
  }

  return [...perPolicy.entries()]
    .sort(([a], [b]) => a - b)
    .map(([policyIndex, changes]) => applyChanges(parsed.policies[policyIndex]!, policyIndex, changes));
}

function applyChanges(policy: Policy, policyIndex: number, pending: Map<string, Pending>): PolicyPatch {
  const changes: DirectiveChange[] = [];

  const render = (name: string, p: Pending): string => {
    const removedNone = p.base.some((v) => v.toLowerCase() === "'none'");
    const values = [...p.base.filter((v) => v.toLowerCase() !== "'none'"), ...p.added];
    const after = [name, ...values].join(' ');
    const existing = findDirective(policy, name);
    changes.push({
      directive: name,
      created: p.created,
      copiedFrom: p.copiedFrom,
      added: p.added,
      removedNone,
      before: existing ? policy.text.slice(existing.span.start, existing.span.end) : undefined,
      after,
    });
    return after;
  };

  const parts = policy.directives.map((d) => {
    const p = pending.get(d.name);
    if (p && !d.duplicate && !p.created) return render(d.name, p);
    return policy.text.slice(d.span.start, d.span.end);
  });
  for (const [name, p] of pending) if (p.created) parts.push(render(name, p));

  return { policyIndex, changes, before: policy.text, after: parts.join('; ') };
}
