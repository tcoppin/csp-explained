import { allChecks, type Requirement, type RequirementResult } from './compat';
import { CANONICAL_DIRECTIVE } from './directives';
import { findDirective } from './fallback';
import type { Directive, ParseResult, Policy } from './model';

export interface DirectiveChange {
  directive: string;
  /** The directive does not exist yet and is created (copying `copiedFrom` values). */
  created: boolean;
  copiedFrom?: string;
  added: string[];
  /** The requirements behind each added value (keyed as in `added`): several tools can ask for the same one. */
  requestedBy: Record<string, Requirement[]>;
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
  requestedBy: Record<string, Requirement[]>;
}

const valuesOf = (d: Directive) => d.values.map((v) => v.raw);

/**
 * Computes the smallest edit that makes every blocked requirement pass, in enforced and report-only policies.
 * When only default-src applies, a dedicated directive is created (copying default-src)
 * instead of widening default-src for every resource type.
 */
export function buildPatches(parsed: ParseResult, results: RequirementResult[]): PolicyPatch[] {
  const perPolicy = new Map<number, Map<string, Pending>>();

  for (const r of results) {
    // Report-only policies too: left alone, they would keep reporting the tool once it is allowed.
    for (const check of allChecks(r)) {
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
          requestedBy: {},
        };
      } else {
        pending = changes.get(target) ?? { created: false, base: valuesOf(governing), added: [], requestedBy: {} };
      }

      const source = r.requirement.source;
      const added = pending.added.find((v) => v.toLowerCase() === source.toLowerCase());
      if (added !== undefined) {
        pending.requestedBy[added]!.push(r.requirement);
        continue;
      }
      // Already listed but ignored (e.g. 'unsafe-inline' next to a nonce): adding it again would change nothing.
      if (pending.base.some((v) => v.toLowerCase() === source.toLowerCase())) continue;
      pending.added.push(source);
      pending.requestedBy[source] = [r.requirement];
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
      requestedBy: p.requestedBy,
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
