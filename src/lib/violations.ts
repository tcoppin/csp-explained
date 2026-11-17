import { addressOf, sourceMatchesAddress } from './catalogue/lookup';
import { requirementsOf } from './catalogue/requirements';
import type { Feature, Vendor } from './catalogue/schema';
import { checkRequirement, type RequirementResult } from './csp/compat';
import { CANONICAL_DIRECTIVE, type ResourceType } from './csp/directives';
import type { ParseResult } from './csp/model';
import { parseSinglePolicy } from './csp/parser';
import { buildPatches } from './csp/patch';
import { parseViolations, type Violation } from './csp/violation';

/** Placeholder for the visitor's site, as in the analysis ('self' only). */
const ORIGIN = 'https://your-site.example';

/**
 * What a console message is about, which decides what we can offer:
 * - `address`: something loaded from an address: the tool behind it and the value that allows it;
 * - `extension`: a browser extension of the person who saw the message: nothing to change in the policy;
 * - `inline`: `<script>` or `<style>` blocks: their hashes when the browser gave them, otherwise how to get them;
 * - `style-attr`: a `style="…"` attribute: its own rule, which keeps scripts protected;
 * - `handler`: an `onclick="…"` attribute: the code has to move, the policy can't allow it safely;
 * - `eval`: code built from text: `'unsafe-eval'`, with what it costs;
 * - `trusted-types`: code handed the browser plain text where the policy requires Trusted Types: the code has to
 *   change, not the policy;
 * - `ancestors`: another site's page refused to be shown in a frame of this one: only that site can change it.
 */
export type ViolationCase = 'address' | 'extension' | 'inline' | 'style-attr' | 'handler' | 'eval' | 'trusted-types' | 'ancestors';

export interface ToolUse {
  vendor: Vendor;
  feature: Feature;
  /** The value the vendor documents, which covers the blocked address. */
  source: string;
}

export interface ViolationFix {
  /** The values to add: one, or the hashes of several inline blocks. */
  add: string[];
  /** The rule they go in. */
  directive: string;
  /** The rule doesn't exist yet (the browser fell back to default-src): it is created from default-src's values. */
  created: boolean;
  /** The value weakens the policy ('unsafe-eval', data: or blob: for scripts): say what it costs. */
  risky: boolean;
  /** One of the lines that allow everything at once covers it (the browser quoted the rule). */
  inLines: boolean;
}

export interface ExplainedViolation {
  /** The message (the first one, for inline code read together). */
  violation: Violation;
  case: ViolationCase;
  /** How many things it stands for: inline blocks of the same kind under the same rule are one item. */
  count: number;
  /** The blocked address's host (or scheme, for data: and blob:). */
  host?: string;
  /**
   * Catalogue tools that use the blocked address, that are known to need what was blocked (eval), or, for Trusted
   * Types, whose address appears in what was pasted.
   */
  tools: ToolUse[];
  fix?: ViolationFix;
}

/** A rule as it should read once everything the messages name is allowed. */
export interface PolicyLine {
  directive: string;
  /** Added to the policy rather than replacing a rule of the same name. */
  created: boolean;
  line: string;
  /** For the report-only policy. */
  reportOnly: boolean;
}

export interface ExplainedMessages {
  items: ExplainedViolation[];
  /** One line per rule to change, for every message whose rule the browser quoted: copying one never drops another. */
  lines: PolicyLine[];
}

const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:/i;
const LOCAL_SCHEME = /^(blob|data|filesystem):/i;
const ANY_URL = /\bhttps?:\/\/[^\s'"“”‘’<>()]+/gi;

/** Every policy message in `input`, explained with the catalogue, and the lines that allow everything they name. */
export function explainViolations(input: string, vendors: Vendor[]): ExplainedMessages {
  const items = group(parseViolations(input)).map(({ v, others }) => explain(v, others, vendors, input));
  return { items, lines: linesFor(items) };
}

/** Inline code of the same kind, under the same rule, read as one item. */
function group(violations: Violation[]): { v: Violation; others: Violation[] }[] {
  const groups = new Map<string, { v: Violation; others: Violation[] }>();
  violations.forEach((v, i) => {
    const key = v.kind === 'inline-script' || v.kind === 'inline-style' ? `${v.kind}|${v.directive}|${v.value ?? ''}|${v.reportOnly}` : `${i}`;
    const g = groups.get(key);
    if (g) g.others.push(v);
    else groups.set(key, { v, others: [] });
  });
  return [...groups.values()];
}

function explain(v: Violation, others: Violation[], vendors: Vendor[], input: string): ExplainedViolation {
  const base = { violation: v, count: 1 + others.length, tools: [] as ToolUse[] };
  if (v.directive === 'frame-ancestors') return { ...base, case: 'ancestors', ...(v.url ? { host: hostOf(v.url) } : {}) };
  switch (v.kind) {
    case 'inline-handler':
      return { ...base, case: 'handler' };
    case 'trusted-types':
      // The message doesn't say what the code was loading; an address pasted with it (the code that was run) may.
      return { ...base, case: 'trusted-types', tools: mentioned(input, vendors) };
    case 'style-attr':
      return { ...base, case: 'style-attr', fix: { add: ["'unsafe-inline'"], directive: 'style-src-attr', created: v.directive !== 'style-src-attr', risky: false, inLines: false } };
    case 'inline-script':
    case 'inline-style': {
      const hashes = [...new Set([v, ...others].map((o) => o.hash).filter((h) => h !== undefined))];
      return { ...base, case: 'inline', ...(hashes.length > 0 ? { fix: fixFor(v, v.type, hashes) } : {}) };
    }
    case 'eval':
      return { ...base, case: 'eval', tools: usesOf(vendors, (r) => r.type === 'eval'), fix: fixFor(v, 'eval', ["'unsafe-eval'"]) };
    case 'url':
      return explainAddress(v, base, vendors);
  }
}

function explainAddress(v: Violation, base: Pick<ExplainedViolation, 'violation' | 'count' | 'tools'>, vendors: Vendor[]): ExplainedViolation {
  const raw = v.url!;
  if (EXTENSION.test(raw)) return { ...base, case: 'extension', host: raw.split('/')[2] ?? raw };
  const local = LOCAL_SCHEME.exec(raw);
  if (local) {
    const scheme = `${local[1]!.toLowerCase()}:`;
    return { ...base, case: 'address', host: scheme, fix: fixFor(v, v.type, [scheme]) };
  }
  const address = addressOf(raw);
  if (!address) return { ...base, case: 'address' };
  const exact = (r: { source: string }) => sourceMatchesAddress(r.source, address) === 'exact';
  // The tool's own line for this kind of resource first: it is what the fix adds.
  const sameKind = usesOf(vendors, (r) => exact(r) && CANONICAL_DIRECTIVE[r.type] === CANONICAL_DIRECTIVE[v.type]);
  const tools = sameKind.length > 0 ? sameKind : usesOf(vendors, exact);
  return { ...base, case: 'address', host: address.host, tools, fix: fixFor(v, v.type, [sameKind[0]?.source ?? address.origin]) };
}

const hostOf = (url: string) => addressOf(url)?.host ?? url;

/** Each tool feature with a requirement passing `test`, once, with the first such requirement's value. */
function usesOf(vendors: Vendor[], test: (r: { type: ResourceType; source: string }) => boolean): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const vendor of vendors) {
    for (const feature of vendor.features) {
      const r = requirementsOf(feature).find(test);
      if (r) uses.push({ vendor, feature, source: r.source });
    }
  }
  return uses;
}

/** The catalogue tools behind any address in the pasted text. */
function mentioned(input: string, vendors: Vendor[]): ToolUse[] {
  const addresses = [...new Set(input.match(ANY_URL) ?? [])].map(addressOf).filter((a) => a !== undefined);
  return usesOf(vendors, (r) => addresses.some((a) => sourceMatchesAddress(r.source, a) === 'exact'));
}

/** Where the values go: the rule the browser named, or the rule of their own kind when it fell back to default-src. */
function fixFor(v: Violation, type: ResourceType, add: string[]): ViolationFix {
  const risky = add.some((a) => a === "'unsafe-eval'" || (/^(?:data|blob):$/.test(a) && (type === 'script' || type === 'worker')));
  return {
    add,
    directive: v.directive && v.directive !== 'default-src' ? v.directive : CANONICAL_DIRECTIVE[type],
    created: v.directive === 'default-src',
    risky,
    inLines: false,
  };
}

/**
 * The rules to change, computed the way the analyzer does on each rule the browser quoted, with every value the
 * messages under it need: a rule that fell back to default-src gets its own rule (copying default-src) instead of
 * widening default-src. Marks the items these lines cover.
 */
function linesFor(items: ExplainedViolation[]): PolicyLine[] {
  const lines: PolicyLine[] = [];
  const byRule = new Map<string, ExplainedViolation[]>();
  for (const item of items) {
    if (!item.fix) continue;
    if (item.case === 'style-attr') {
      const reportOnly = item.violation.reportOnly;
      if (!lines.some((l) => l.directive === 'style-src-attr' && l.reportOnly === reportOnly)) {
        lines.push({ directive: 'style-src-attr', created: item.fix.created, line: "style-src-attr 'unsafe-inline'", reportOnly });
      }
      item.fix.inLines = true;
      continue;
    }
    if (!item.violation.value) continue;
    const key = `${item.violation.value}|${item.violation.reportOnly}`;
    byRule.set(key, [...(byRule.get(key) ?? []), item]);
  }

  for (const group of byRule.values()) {
    const value = group[0]!.violation.value!;
    const parsed: ParseResult = { input: value, policies: [parseSinglePolicy(value)], issues: [] };
    const results: [ExplainedViolation, RequirementResult][] = group.flatMap((item) =>
      item.fix!.add.map((source) => [item, checkRequirement(parsed, { type: item.case === 'eval' ? 'eval' : item.violation.type, source, reason: '' }, ORIGIN)] as [ExplainedViolation, RequirementResult]),
    );
    const blocked = results.filter(([, r]) => r.verdict === 'blocked');
    for (const [item] of blocked) item.fix!.inLines = true;
    const patch = buildPatches(parsed, blocked.map(([, r]) => r), ORIGIN)[0];
    for (const change of patch?.changes ?? []) {
      lines.push({ directive: change.directive, created: change.created, line: change.after, reportOnly: group[0]!.violation.reportOnly });
    }
  }
  return lines;
}
