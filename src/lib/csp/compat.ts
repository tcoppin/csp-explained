import type { ResourceType } from './directives';
import { checkResource, type MatchResult, type Verdict } from './matcher';
import type { ParseResult } from './model';
import { classify } from './parser';

/** One thing a third-party tool needs from the policy, as documented by the vendor. */
export interface Requirement {
  type: ResourceType;
  /** Source expression the vendor asks to add, e.g. `https://*.example.com` or `'unsafe-inline'`. */
  source: string;
  /** Concrete URL to test; derived from `source` when absent. */
  probe?: string;
  reason: string;
  optional?: boolean;
}

export type RequirementVerdict =
  | Verdict
  /** Only Report-Only policies would object: nothing is blocked, but violations get reported. */
  | 'reported';

export interface PolicyCheck {
  policyIndex: number;
  match: MatchResult;
}

export interface RequirementResult {
  requirement: Requirement;
  /** What the browser does: decided by the enforced policies, or 'reported' when there are only report-only ones. */
  verdict: RequirementVerdict;
  /** One entry per enforced policy. */
  checks: PolicyCheck[];
  /** One entry per report-only policy, checked even when an enforced policy decides the verdict. */
  reportOnly: PolicyCheck[];
  /** A report-only policy would report the load, whatever the enforced policies do. */
  reported: boolean;
}

const SUBDOMAIN_PLACEHOLDER = 'any-subdomain';

/** Builds a URL that the vendor's source expression is meant to cover. */
export function probeFor(req: Requirement, selfOrigin: string): string | undefined {
  if (req.probe) return req.probe;
  const expr = classify(req.source, { start: 0, end: req.source.length });
  switch (expr.kind) {
    case 'keyword':
      return expr.value === "'self'" ? new URL('/', selfOrigin).href : undefined;
    case 'scheme': {
      const scheme = expr.value.slice(0, -1);
      if (scheme === 'data') return 'data:,probe';
      if (scheme === 'blob') return `blob:${new URL(selfOrigin).origin}/probe`;
      return `${scheme}://example.org/`;
    }
    case 'host': {
      const h = expr.host!;
      const host = h.host === '*' ? 'example.org' : h.host.replace(/^\*\./, `${SUBDOMAIN_PLACEHOLDER}.`);
      const port = h.port && h.port !== '*' ? `:${h.port}` : '';
      const path = h.path ? (h.path.endsWith('/') ? `${h.path}probe` : h.path) : '/';
      return `${h.scheme ?? 'https'}://${host}${port}${path}`;
    }
    default:
      return undefined;
  }
}

const SEVERITY: Record<Verdict, number> = { allowed: 0, 'needs-nonce': 1, blocked: 2 };

function worst(checks: PolicyCheck[]): Verdict {
  return checks.reduce<Verdict>((acc, c) => (SEVERITY[c.match.verdict] > SEVERITY[acc] ? c.match.verdict : acc), 'allowed');
}

/**
 * Every enforced policy must allow a load: they decide the verdict. Report-Only policies never block,
 * but each one is checked too, since it reports a load it wouldn't allow even when the enforced ones do.
 */
export function checkRequirement(parsed: ParseResult, req: Requirement, selfOrigin: string): RequirementResult {
  const url = probeFor(req, selfOrigin);
  const hash = classify(req.source, { start: 0, end: req.source.length }).kind === 'hash' ? req.source : undefined;
  const run = (reportOnly: boolean) =>
    parsed.policies
      .map((policy, policyIndex) => ({ policy, policyIndex }))
      .filter(({ policy }) => policy.reportOnly === reportOnly && policy.directives.length > 0)
      .map(({ policy, policyIndex }) => ({ policyIndex, match: checkResource(policy, req.type, url, selfOrigin, hash) }));

  const enforced = run(false);
  const reportOnly = run(true);
  const reported = worst(reportOnly) !== 'allowed';
  const verdict = enforced.length > 0 ? worst(enforced) : reported ? 'reported' : 'allowed';
  return { requirement: req, verdict, checks: enforced, reportOnly, reported };
}

/** Every policy's check, enforced ones first. */
export const allChecks = (r: RequirementResult): PolicyCheck[] => [...r.checks, ...r.reportOnly];

export function checkRequirements(parsed: ParseResult, reqs: Requirement[], selfOrigin: string): RequirementResult[] {
  return reqs.map((r) => checkRequirement(parsed, r, selfOrigin));
}
