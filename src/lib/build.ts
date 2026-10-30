import { DEFAULT_ORIGIN, sameFinding } from './analysis';
import { checkRequirements, type Requirement, type RequirementResult } from './csp/compat';
import { KEYWORDS, type ResourceType } from './csp/directives';
import type { Policy } from './csp/model';
import { classify, parse, parseSinglePolicy } from './csp/parser';
import { buildPatches, type DirectiveChange } from './csp/patch';
import { evaluateSecurity, type SecurityFinding } from './csp/security';

/**
 * The policy builder: a starting policy plus what the site and its tools need, turned into one policy
 * with every added value traced back to whoever asked for it. Same engine as the analyzer's patches.
 */

export type BaselineMode = 'allowlist' | 'nonce';

/** Stands for the random value the server writes into each page; the builder can't know it. */
export const NONCE_PLACEHOLDER = "'nonce-REPLACE_PER_PAGE'";

const DOCUMENT = ["object-src 'none'", "form-action 'self'", "frame-ancestors 'self'", 'upgrade-insecure-requests'];

export function baselinePolicy(mode: BaselineMode): string {
  const parts =
    mode === 'nonce'
      ? ["default-src 'self'", `script-src ${NONCE_PLACEHOLDER} 'strict-dynamic'`, "base-uri 'none'"]
      : ["default-src 'self'", "base-uri 'self'"];
  return [...parts, ...DOCUMENT].join('; ');
}

/** Whoever asks for something: a catalogue tool, one of the visitor's own tools, or the site itself. */
export interface Contributor {
  kind: 'vendor' | 'custom' | 'site';
  id: string;
  label: string;
}

export interface Contribution {
  by: Contributor;
  requirements: Requirement[];
}

/** What the visitor's own pages do, asked as yes/no questions. `reason` is the need's id, worded by the UI. */
export const SITE_NEEDS = {
  'inline-scripts': [{ type: 'inline-script', source: "'unsafe-inline'" }],
  'inline-handlers': [{ type: 'inline-handler', source: "'unsafe-inline'" }],
  eval: [{ type: 'eval', source: "'unsafe-eval'" }],
  'inline-styles': [{ type: 'inline-style', source: "'unsafe-inline'" }],
  'style-attributes': [{ type: 'style-attr', source: "'unsafe-inline'" }],
  'data-images': [{ type: 'img', source: 'data:' }],
} satisfies Record<string, { type: ResourceType; source: string }[]>;

export type SiteNeed = keyof typeof SITE_NEEDS;

export function siteContribution(needs: SiteNeed[]): Contribution {
  return {
    by: { kind: 'site', id: 'site', label: 'site' },
    requirements: needs.flatMap((id) => SITE_NEEDS[id].map((r) => ({ ...r, reason: id }))),
  };
}

/** A tool the catalogue doesn't know, described by the visitor. */
export interface CustomTool {
  id: string;
  name: string;
  needs: { type: ResourceType; sources: string[] }[];
}

export function customContribution(tool: CustomTool): Contribution {
  return {
    by: { kind: 'custom', id: tool.id, label: tool.name },
    requirements: tool.needs.flatMap((n) => n.sources.filter(isValidSource).map((source) => ({ type: n.type, source, reason: '' }))),
  };
}

/**
 * A source expression the browser would understand as meant (keywords, schemes, hosts; not nonces or hashes,
 * which change per page or per file, nor `self` without quotes, which browsers read as a host named "self").
 */
export function isValidSource(source: string): boolean {
  const expr = classify(source, { start: 0, end: source.length });
  if (expr.kind === 'host') return !KEYWORDS.has(`'${expr.value}'`);
  return expr.kind === 'keyword' || expr.kind === 'scheme';
}

/** One requirement and what happened to it. */
export interface PlacedRequirement {
  by: Contributor;
  result: RequirementResult;
  /** The directive the value was added to; absent when the starting policy already allowed it, or can't. */
  addedTo?: string;
}

export interface BuiltPolicy {
  /** The starting policy, as parsed. Undefined when the text held no directive. */
  base?: Policy;
  /** Enforced policies left out: the builder works on one policy at a time. */
  otherPolicies: number;
  text: string;
  policy?: Policy;
  changes: DirectiveChange[];
  requirements: PlacedRequirement[];
  findings: SecurityFinding[];
  /** Findings the additions bring, compared with the starting policy. */
  introducedFindings: SecurityFinding[];
}

/** The policy to build on: the first enforced one in the text, else the first one. */
function pickBase(text: string): { base?: Policy; others: number } {
  const policies = parse(text).policies.filter((p) => p.directives.length > 0);
  const base = policies.find((p) => !p.reportOnly) ?? policies[0];
  return { base, others: policies.length - (base ? 1 : 0) };
}

export function buildPolicy(baseText: string, contributions: Contribution[], origin = DEFAULT_ORIGIN): BuiltPolicy {
  const { base, others } = pickBase(baseText);
  if (!base) return { otherPolicies: 0, text: '', changes: [], requirements: [], findings: [], introducedFindings: [] };

  // What this policy would do once it decides: a Report-Only one would only get 'reported' verdicts otherwise.
  const parsed = { input: base.text, policies: [{ ...base, reportOnly: false }], issues: [] };
  const owner = new Map<Requirement, Contributor>();
  for (const c of contributions) for (const r of c.requirements) owner.set(r, c.by);

  const results = checkRequirements(parsed, [...owner.keys()], origin);
  const patch = buildPatches(parsed, results)[0];
  const changes = patch?.changes ?? [];
  const text = patch?.after ?? base.text;
  const policy = patch ? parseSinglePolicy(text, base.origin, base.reportOnly) : base;

  const addedTo = (r: Requirement) =>
    changes.find((c) => Object.values(c.requestedBy).some((reqs) => reqs.includes(r)))?.directive;
  const requirements = results.map((result) => ({
    by: owner.get(result.requirement)!,
    result,
    addedTo: addedTo(result.requirement),
  }));

  const before = new Set(evaluateSecurity({ policies: [base] }).map(sameFinding));
  const findings = evaluateSecurity({ policies: [policy] });
  return {
    base,
    otherPolicies: others,
    text,
    policy,
    changes,
    requirements,
    findings,
    introducedFindings: findings.filter((f) => !before.has(sameFinding(f))),
  };
}

/** Who asked for a value of the built policy; empty for values of the starting policy. */
export function askedFor(built: BuiltPolicy, directive: string, value: string): PlacedRequirement[] {
  const change = built.changes.find((c) => c.directive === directive);
  const reqs = change?.requestedBy[value];
  if (!reqs) return [];
  return built.requirements.filter((p) => reqs.includes(p.result.requirement));
}
