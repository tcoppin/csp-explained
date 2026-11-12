import { DEFAULT_ORIGIN, sameFinding } from './analysis';
import { checkRequirement, checkRequirements, type Requirement, type RequirementResult } from './csp/compat';
import { KEYWORDS, NONCE_PLACEHOLDER, type ResourceType } from './csp/directives';
import type { Policy } from './csp/model';
import { classify, parse, parseSinglePolicy } from './csp/parser';
import { buildPatches, type DirectiveChange } from './csp/patch';
import { INLINE_TYPE, type InlineHash } from './csp/hash';
import { evaluateSecurity, type SecurityFinding } from './csp/security';

/**
 * The policy builder: a starting policy plus what the site and its tools need, turned into one policy
 * with every added value traced back to whoever asked for it. Same engine as the analyzer's patches.
 */

export type BaselineMode = 'allowlist' | 'nonce';

export { NONCE_PLACEHOLDER };

const DOCUMENT = ["object-src 'none'", "form-action 'self'", "frame-ancestors 'self'", 'upgrade-insecure-requests'];

/**
 * The starting policy. `olderBrowsers` adds the usual fallback for browsers without 'strict-dynamic' (before 2022):
 * `'unsafe-inline' https:`, which browsers that support it ignore, so they stay as protected.
 */
export function baselinePolicy(mode: BaselineMode, olderBrowsers = false): string {
  const fallback = olderBrowsers ? " 'unsafe-inline' https:" : '';
  const parts =
    mode === 'nonce'
      ? ["default-src 'self'", `script-src ${NONCE_PLACEHOLDER} 'strict-dynamic'${fallback}`, "base-uri 'none'"]
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

/** Needs that can name each inline block by its hash instead of allowing them all with 'unsafe-inline'. */
export const HASHABLE = { 'inline-scripts': 'inline-script', 'inline-styles': 'inline-style' } as const satisfies Partial<Record<SiteNeed, ResourceType>>;
export type HashableNeed = keyof typeof HASHABLE;
export const isHashable = (need: SiteNeed): need is HashableNeed => need in HASHABLE;

/** The hashes listed for a need; a need present here (even with no hash yet) is allowed by hash only. */
export type SiteHashes = Partial<Record<HashableNeed, string[]>>;

export function siteContribution(needs: SiteNeed[], hashes: SiteHashes = {}): Contribution {
  return {
    by: { kind: 'site', id: 'site', label: 'site' },
    requirements: needs.flatMap((id) => {
      const listed = isHashable(id) ? hashes[id] : undefined;
      if (listed) return listed.map((source) => ({ type: HASHABLE[id as HashableNeed], source, reason: id }));
      return SITE_NEEDS[id].map((r) => ({ ...r, reason: id }));
    }),
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

const isHash = (r: Requirement) => classify(r.source, { start: 0, end: r.source.length }).kind === 'hash';

/** One patch after the other: the second one's `before` is the first one's `after`. */
function mergeChanges(first: DirectiveChange[], second: DirectiveChange[]): DirectiveChange[] {
  const merged = first.map((a) => {
    const b = second.find((c) => c.directive === a.directive);
    if (!b) return a;
    return { ...a, added: [...a.added, ...b.added], requestedBy: { ...a.requestedBy, ...b.requestedBy }, removedNone: a.removedNone || b.removedNone, after: b.after };
  });
  return [...merged, ...second.filter((b) => !first.some((a) => a.directive === b.directive))];
}

export function buildPolicy(baseText: string, contributions: Contribution[], origin = DEFAULT_ORIGIN): BuiltPolicy {
  const { base, others } = pickBase(baseText);
  if (!base) return { otherPolicies: 0, text: '', changes: [], requirements: [], findings: [], introducedFindings: [] };

  const owner = new Map<Requirement, Contributor>();
  for (const c of contributions) for (const r of c.requirements) owner.set(r, c.by);

  // Hashes first: once listed, the browser ignores 'unsafe-inline' in that directive, which the other
  // requirements must be checked against (a tool asking for it then needs a hash or the nonce instead).
  const all = [...owner.keys()];
  let text = base.text;
  let changes: DirectiveChange[] = [];
  const results: RequirementResult[] = [];
  for (const group of [all.filter(isHash), all.filter((r) => !isHash(r))]) {
    if (group.length === 0) continue;
    // What this policy would do once it decides: a Report-Only one would only get 'reported' verdicts otherwise.
    const current = parseSinglePolicy(text, base.origin, false);
    const groupResults = checkRequirements({ input: text, policies: [current], issues: [] }, group, origin);
    const patch = buildPatches({ input: text, policies: [current], issues: [] }, groupResults, origin)[0];
    results.push(...groupResults);
    if (!patch) continue;
    changes = mergeChanges(changes, patch.changes);
    text = patch.after;
  }
  const policy = text === base.text ? base : parseSinglePolicy(text, base.origin, base.reportOnly);

  const addedTo = (r: Requirement) =>
    changes.find((c) => Object.values(c.requestedBy).some((reqs) => reqs.includes(r)))?.directive;
  // In the order the contributions came.
  const requirements = all.map((r) => {
    const result = results.find((x) => x.requirement === r)!;
    return { by: owner.get(r)!, result, addedTo: addedTo(r) };
  });

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

export interface HashedPolicy {
  text: string;
  /** `style-src-attr 'unsafe-inline'` was added, so style attributes keep working beside the style hashes. */
  styleAttributes: boolean;
}

/** A policy with inline blocks listed by hash, as the analyzer offers in place of 'unsafe-inline'. */
export function withHashes(policyText: string, hashes: InlineHash[], origin = DEFAULT_ORIGIN): HashedPolicy {
  const requirements: Requirement[] = hashes.map((h) => ({ type: INLINE_TYPE[h.kind], source: h.source, reason: '' }));
  // Style attributes allowed today would stop working once style-src lists a hash. Asked by verdict: a load that no
  // directive restricts is allowed without a matching source, and a reported one isn't allowed today.
  const styleAttr: Requirement = { type: 'style-attr', source: "'unsafe-inline'", reason: '' };
  const allowedToday = checkRequirement(parse(policyText), styleAttr, origin).verdict === 'allowed';
  if (allowedToday && hashes.some((h) => h.kind === 'style')) requirements.push(styleAttr);
  const built = buildPolicy(policyText, [{ by: { kind: 'site', id: 'site', label: 'site' }, requirements }], origin);
  return { text: built.text, styleAttributes: built.changes.some((c) => c.directive === 'style-src-attr') };
}
