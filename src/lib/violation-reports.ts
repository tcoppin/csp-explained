import type { Vendor } from './catalogue/schema';
import { resolve } from './csp/fallback';
import { parseSinglePolicy } from './csp/parser';
import { DIRECTIVE_TYPE, trustedTypeOf, type BlockedKind, type Violation } from './csp/violation';
import { browserOf, readReports, type ReadReports, type ViolationReport } from './csp/violation-report';
import { explainItems, linesOf, type ExplainedViolation, type FixedPolicy, type PolicyLine } from './violations';

/**
 * Violation reports read together: grouped by what was blocked, under which rule and policy; each group explained
 * the way a console message is (the tool behind it, the line that allows it), with how many reports, pages and
 * browsers it stands for. What doesn't come from the site (browser extensions) is set apart.
 *
 * A report says something was blocked, not that it should be allowed: a script injected into the page, or a tool
 * that was hacked, is blocked the same way as a tool someone forgot. So an address no catalogue tool uses, outside
 * the site's own domain, is unknown: explained, but kept out of the lines until the visitor says they know it.
 */

/** One problem: reports about the same thing, under the same rule of the same policy. */
export interface ReportGroup {
  explained: ExplainedViolation;
  reports: number;
  /** The pages it happened on (address without its query string or `#` part), most reports first. */
  pages: { page: string; reports: number }[];
  /** The browsers that sent it, most reports first; reports without a browser aren't counted. */
  browsers: string[];
  /** Index in `policies`. */
  policy: number;
  /** Identifies the problem from one reading to the next (for `trusted`). */
  key: string;
  /**
   * An address no catalogue tool uses, outside the site's own domain: a forgotten tool, or injected code. Its line
   * is left out unless the visitor said they know it (`trusted`); then `fix` is set and covered by the lines.
   */
  unknown?: true;
  /** Not the site's doing: a browser extension (the address, or the code that asked for it). */
  noise?: 'extension';
}

export interface ReportPolicy {
  text: string;
  reportOnly: boolean;
  /** No report said whether it was enforced (Safari's older format): taken as enforced. */
  guessed: boolean;
  reports: number;
  /** The policy with every line its reports need, when some do. */
  fixed?: FixedPolicy;
}

/** A Trusted Types policy name the `trusted-types` rule doesn't list. */
export interface RefusedPolicyName {
  name: string;
  reports: number;
  policy: number;
}

export interface ExplainedReports {
  /** Reports read. */
  total: number;
  /** Lines that held something else. */
  skipped: number;
  /** Problems, most reports first. */
  groups: ReportGroup[];
  /** Set apart: not caused by the site. */
  noise: ReportGroup[];
  /** One line per rule to change, per policy. */
  lines: PolicyLine[];
  policies: ReportPolicy[];
  names: RefusedPolicyName[];
  /** The site's origin, when every report comes from the same one. */
  origin?: string;
}

const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:/i;
const INLINE = new Set(['inline', '', 'self']);

export interface ReportOptions {
  /** Keys of unknown addresses the visitor knows: their lines go in. */
  trusted?: ReadonlySet<string>;
}

/** The reports in `input` (text, or reports already read), grouped and explained with the catalogue. */
export function explainReports(input: string | ReadReports, vendors: Vendor[], { trusted = new Set() }: ReportOptions = {}): ExplainedReports {
  const { reports, skipped } = typeof input === 'string' ? readReports(input) : input;
  const origins = new Set(reports.map((r) => originOf(r.page)).filter((o) => o !== undefined));
  const origin = origins.size === 1 ? [...origins][0]! : undefined;

  const policies: ReportPolicy[] = [];
  const policyIndex = (r: ViolationReport) => {
    const text = r.policy ?? '';
    const reportOnly = r.disposition === 'report';
    let i = policies.findIndex((p) => p.text === text && p.reportOnly === reportOnly);
    if (i < 0) i = policies.push({ text, reportOnly, guessed: r.guessed === true, reports: 0 }) - 1;
    policies[i]!.reports++;
    return i;
  };

  interface Pending {
    key: string;
    v: Violation;
    reports: ViolationReport[];
    policy: number;
    noise?: 'extension';
  }
  const pending = new Map<string, Pending>();
  const names = new Map<string, RefusedPolicyName>();
  for (const r of reports) {
    const policy = policyIndex(r);
    if (r.blocked === 'trusted-types-policy') {
      const name = r.sample?.trim() || '?';
      const key = `${policy}|${name}`;
      const known = names.get(key);
      if (known) known.reports++;
      else names.set(key, { name, reports: 1, policy });
      continue;
    }
    const v = violationOf(r);
    const noise = EXTENSION.test(r.blocked) || EXTENSION.test(r.sourceFile ?? '') ? ('extension' as const) : undefined;
    const target = v.kind === 'url' ? (originOf(v.url) ?? v.url) : `${v.kind}|${v.sink ?? ''}`;
    const key = `${policy}|${v.effective ?? v.directive}|${target}|${noise ?? ''}`;
    const group = pending.get(key);
    if (group) group.reports.push(r);
    else pending.set(key, { key, v, reports: [r], policy, ...(noise ? { noise } : {}) });
  }

  // Lines only from what the site itself needs: what an extension asked for never goes in, nor an unknown address
  // the visitor hasn't vouched for.
  const options = { whole: true, ...(origin ? { origin } : {}) };
  const site = [...pending.values()].filter((p) => !p.noise);
  const elsewhere = [...pending.values()].filter((p) => p.noise);
  const siteItems = explainItems(site.map((p) => ({ v: p.v, others: [] })), vendors).map((item, i) => {
    const unknown = isUnknown(item, site[i]!.reports, origin);
    return { item: unknown && !trusted.has(site[i]!.key) ? { ...item, fix: undefined } : item, unknown };
  });
  const explained = linesOf(siteItems.map((s) => s.item), options);
  const items = [...siteItems.map((s) => s.item), ...explainItems(elsewhere.map((p) => ({ v: p.v, others: [] })), vendors)];
  const all: ReportGroup[] = [...site, ...elsewhere].map((p, i) => {
    const item = items[i]!;
    // An extension's own code asking for an address: nothing to add to the policy.
    const shown: ExplainedViolation =
      p.noise && item.case !== 'extension' ? { ...item, case: 'extension', host: hostOf(p.reports[0]!.sourceFile ?? p.v.url ?? ''), tools: [], fix: undefined } : item;
    return {
      explained: shown,
      reports: p.reports.length,
      pages: ranked(p.reports.map((r) => pageOf(r.page, origin))).map(([page, reports]) => ({ page, reports })),
      browsers: ranked(p.reports.map((r) => browserOf(r.userAgent))).map(([b]) => b),
      policy: p.policy,
      key: p.key,
      ...(siteItems[i]?.unknown ? { unknown: true as const } : {}),
      ...(p.noise ? { noise: p.noise } : {}),
    };
  });
  for (const fixed of explained.fixed) {
    const policy = policies.find((p) => p.text === fixed.before && p.reportOnly === fixed.reportOnly);
    if (policy) policy.fixed = fixed;
  }
  const byReports = (a: ReportGroup, b: ReportGroup) => b.reports - a.reports;
  return {
    total: reports.length,
    skipped,
    groups: all.filter((g) => !g.noise).sort(byReports),
    noise: all.filter((g) => g.noise).sort(byReports),
    lines: explained.lines,
    policies,
    names: [...names.values()].sort((a, b) => b.reports - a.reports),
    ...(origin ? { origin } : {}),
  };
}

/**
 * An address no catalogue tool uses, on a host outside the domain of the pages that reported it. Local schemes
 * (`data:`, `blob:`) aren't addresses anyone can serve from elsewhere: they keep their own warning.
 */
function isUnknown(item: ExplainedViolation, reports: ViolationReport[], origin: string | undefined): boolean {
  if (item.case !== 'address' || item.tools.length > 0 || !item.violation.url) return false;
  let host: string;
  try {
    const u = new URL(item.violation.url);
    if (!/^(?:https?|wss?):$/.test(u.protocol)) return false;
    host = u.hostname;
  } catch {
    return false;
  }
  const sites = new Set([origin, ...reports.map((r) => originOf(r.page))].filter((o) => o !== undefined).map((o) => siteOf(new URL(o).hostname)));
  return !sites.has(siteOf(host));
}

/** Second-level suffixes a registrable domain sits under (`shop.co.uk`): close enough without the public suffix list. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or', 'go', 'gob', 'gouv']);

/** The domain a host belongs to (`cdn.shop.example.com` → `example.com`), so a site's own subdomains count as its own. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2 || /^[\d.]+$/.test(host) || host.includes(':')) return labels.join('.');
  const n = labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/** A report as a console message would have told it: what was blocked, under which rule, of which policy. */
function violationOf(r: ViolationReport): Violation {
  const effective = r.directive;
  const policy = r.policy ? parseSinglePolicy(r.policy) : undefined;
  const directive = (policy && resolve(policy, effective).governing?.name) || effective;
  const blocked = r.blocked.toLowerCase();
  const kind = kindOf(blocked, effective);
  const base = {
    text: `${effective} ${r.blocked}`,
    directive,
    ...(effective !== directive ? { effective } : {}),
    ...(r.policy ? { value: r.policy } : {}),
    reportOnly: r.disposition === 'report',
    count: 1,
  };
  if (kind === 'trusted-types') {
    // The sample starts with the sink: "HTMLScriptElement src|https://…", "Element innerHTML|<img…".
    const sinkMatch = /^([A-Z][\w$]*) ([\w$]+)\|/.exec(r.sample ?? '');
    const sink = sinkMatch ? `${sinkMatch[1]}.${sinkMatch[2]}` : undefined;
    const trustedType = sink ? trustedTypeOf(sink) : undefined;
    return { ...base, kind, type: 'script', ...(sink ? { sink } : {}), ...(trustedType ? { trustedType } : {}) };
  }
  if (kind === 'url') {
    const url = blocked === 'data' || blocked === 'blob' ? `${blocked}:` : r.blocked;
    return { ...base, kind, url, type: DIRECTIVE_TYPE[effective] ?? DIRECTIVE_TYPE[directive] ?? (effective === 'child-src' ? 'frame' : 'script') };
  }
  return { ...base, kind, type: kind };
}

function kindOf(blocked: string, directive: string): BlockedKind {
  if (blocked === 'eval' || blocked === 'wasm-eval') return 'eval';
  if (blocked.startsWith('trusted-types')) return 'trusted-types';
  if (INLINE.has(blocked)) {
    if (directive === 'script-src-attr') return 'inline-handler';
    if (directive === 'style-src-attr') return 'style-attr';
    return directive.startsWith('style') ? 'inline-style' : 'inline-script';
  }
  return 'url';
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** A page's address without its query string or `#` part (they can hold personal data), and without the site's origin. */
function pageOf(url: string | undefined, origin: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.origin === origin ? u.pathname : `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** The distinct values, most frequent first, without the missing ones. */
function ranked(values: (string | undefined)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
