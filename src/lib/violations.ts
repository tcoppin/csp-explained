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
 * - `style-attr`: a `style="…"` attribute: the styles move into the stylesheet;
 * - `handler`: an `onclick="…"` attribute: the code moves into a script;
 * - `eval`: code built from text: code that doesn't, or a version of the tool that doesn't;
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

/** A value that allows only what was blocked: an address, a hash, `data:` for images. */
export interface ViolationFix {
  /** The values to add: one, or the hashes of several inline blocks. */
  add: string[];
  /** The rule they go in. */
  directive: string;
  /** The rule doesn't exist yet (the browser fell back to default-src): it is created from default-src's values. */
  created: boolean;
  /** One of the lines that allow everything at once covers it (the browser quoted the rule). */
  inLines: boolean;
}

/**
 * What weakens the policy for everyone, not only for what was blocked: `'unsafe-inline'`, `'unsafe-eval'`, `data:` or
 * `blob:` for scripts. Never in the lines: the safe way comes first, and this is shown only when asked, with what it
 * costs.
 */
export interface WeakerFix {
  /** What it lets in, which decides the warning. */
  risk: 'eval' | 'scheme' | 'inline-script' | 'inline-style' | 'style-attr' | 'handler';
  add: string[];
  directive: string;
  created: boolean;
  /** The rule with the value, to copy on its own, when the browser quoted the rule. */
  line?: string;
  /** The rule has a nonce or a hash: browsers ignore `'unsafe-inline'` there, so it wouldn't change anything. */
  ignored?: true;
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
  weaker?: WeakerFix;
}

/** A rule as it should read once everything the messages name is allowed. */
export interface PolicyLine {
  directive: string;
  /** Added to the policy rather than replacing a rule of the same name. */
  created: boolean;
  line: string;
  /** For the report-only policy. */
  reportOnly: boolean;
  /** The rule or policy it changes, as quoted by the browser or carried by the report. */
  policy: string;
}

/** A policy as it was, and as it reads with every line it needs (reports carry the whole policy). */
export interface FixedPolicy {
  before: string;
  after: string;
  reportOnly: boolean;
}

export interface ExplainedMessages {
  items: ExplainedViolation[];
  /** One line per rule to change, for every message whose rule the browser quoted: copying one never drops another. */
  lines: PolicyLine[];
  /** What each rule or policy the lines change reads like once changed. */
  fixed: FixedPolicy[];
}

/** Violations already read together (a message and the inline blocks read with it). */
export interface ViolationGroup {
  v: Violation;
  others: Violation[];
}

const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:/i;
const LOCAL_SCHEME = /^(blob|data|filesystem):/i;
// An address written in code (`s.src = "https://…"`, `fetch('https://…')`): what was run, unlike the addresses in
// the browser's own lines, which it quotes with “curly” quotes.
const CODE_URL = /(?:=|\()\s*["'`](https?:\/\/[^"'`\s]+)["'`]/gi;

/** Every policy message in `input`, explained with the catalogue, and the lines that allow everything they name. */
export function explainViolations(input: string, vendors: Vendor[]): ExplainedMessages {
  return explainGroups(group(parseViolations(input)), vendors, { input });
}

/** Each group explained (in the same order), and the lines that allow everything they name. */
export function explainGroups(groups: ViolationGroup[], vendors: Vendor[], { input = '', origin = ORIGIN }: ExplainOptions = {}): ExplainedMessages {
  const items = explainItems(groups, vendors, input);
  return { items, ...linesFor(items, origin) };
}

/** Each group explained, in the same order, without the lines: for a caller that leaves some items out of them. */
export function explainItems(groups: ViolationGroup[], vendors: Vendor[], input = ''): ExplainedViolation[] {
  return groups.map(({ v, others }) => explain(v, others, vendors, input));
}

/** The lines that allow what `items` name, and the policies they change (marks the items they cover). */
export function linesOf(items: ExplainedViolation[], { origin = ORIGIN }: Omit<ExplainOptions, 'input'> = {}): Pick<ExplainedMessages, 'lines' | 'fixed'> {
  return linesFor(items, origin);
}

export interface ExplainOptions {
  /** What was pasted, for the addresses in code pasted with Trusted Types messages. */
  input?: string;
  /** The site's origin, when known ('self'). */
  origin?: string;
}

/** Inline code of the same kind, under the same rule, read as one item. */
function group(violations: Violation[]): ViolationGroup[] {
  const groups = new Map<string, ViolationGroup>();
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
      return { ...base, case: 'handler', weaker: weakerFor('handler', 'script-src-attr', "'unsafe-inline'", v.directive !== 'script-src-attr') };
    case 'trusted-types':
      // The message doesn't say what the code was loading; an address pasted with it (the code that was run) may.
      return { ...base, case: 'trusted-types', tools: mentioned(input, vendors) };
    case 'style-attr':
      return { ...base, case: 'style-attr', weaker: weakerFor('style-attr', 'style-src-attr', "'unsafe-inline'", v.directive !== 'style-src-attr') };
    case 'inline-script':
    case 'inline-style': {
      const hashes = [...new Set([v, ...others].map((o) => o.hash).filter((h) => h !== undefined))];
      if (hashes.length > 0) return { ...base, case: 'inline', fix: fixFor(v, v.type, hashes) };
      const { directive, created } = fixFor(v, v.type, []);
      return { ...base, case: 'inline', weaker: weakerFor(v.kind, directive, "'unsafe-inline'", created) };
    }
    case 'eval': {
      const { directive, created } = fixFor(v, 'eval', []);
      return { ...base, case: 'eval', tools: usesOf(vendors, (r) => r.type === 'eval'), weaker: weakerFor('eval', directive, "'unsafe-eval'", created) };
    }
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
    // Content made in the page, which an attacker can make too: for code, that's as good as any script.
    if (v.type === 'script' || v.type === 'worker') {
      const { directive, created } = fixFor(v, v.type, []);
      return { ...base, case: 'address', host: scheme, weaker: weakerFor('scheme', directive, scheme, created) };
    }
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

/** The catalogue tools behind an address in code pasted with the messages. */
function mentioned(input: string, vendors: Vendor[]): ToolUse[] {
  const addresses = [...new Set([...input.matchAll(CODE_URL)].map((m) => m[1]!))].map(addressOf).filter((a) => a !== undefined);
  return usesOf(vendors, (r) => addresses.some((a) => sourceMatchesAddress(r.source, a) === 'exact'));
}

/** Where the values go: the rule the browser named, or the rule of their own kind when it fell back to default-src. */
function fixFor(v: Violation, type: ResourceType, add: string[]): ViolationFix {
  return {
    add,
    directive: v.directive && v.directive !== 'default-src' ? v.directive : CANONICAL_DIRECTIVE[type],
    created: v.directive === 'default-src',
    inLines: false,
  };
}

const weakerFor = (risk: WeakerFix['risk'], directive: string, add: string, created: boolean): WeakerFix => ({ risk, add: [add], directive, created });

/** The requirement a weaker value answers, for the patch that adds it. */
const WEAKER_TYPE: Record<'eval' | 'inline-script' | 'inline-style', ResourceType> = { eval: 'eval', 'inline-script': 'inline-script', 'inline-style': 'inline-style' };
/** Attributes get a rule of their own, so that `<script>` and `<style>` blocks stay protected. */
const ATTR_LINE = { 'style-attr': "style-src-attr 'unsafe-inline'", handler: "script-src-attr 'unsafe-inline'" } as const;

/**
 * The rules to change, computed the way the analyzer does on each rule the browser quoted, with every value the
 * messages under it need: a rule that fell back to default-src gets its own rule (copying default-src) instead of
 * widening default-src. Marks the items these lines cover. Only safe values go in (`fix`); a weaker one gets its own
 * line, shown apart.
 */
function linesFor(items: ExplainedViolation[], origin: string): Pick<ExplainedMessages, 'lines' | 'fixed'> {
  const lines: PolicyLine[] = [];
  const fixed: FixedPolicy[] = [];
  const byRule = new Map<string, ExplainedViolation[]>();
  for (const item of items) {
    if (item.weaker && item.violation.value) weakerLine(item.weaker, item, origin);
    if (!item.fix || !item.violation.value) continue;
    const key = `${item.violation.value}|${item.violation.reportOnly}`;
    byRule.set(key, [...(byRule.get(key) ?? []), item]);
  }

  for (const group of byRule.values()) {
    const value = group[0]!.violation.value!;
    const reportOnly = group[0]!.violation.reportOnly;
    const parsed = parsedOf(value);
    const results: [ExplainedViolation, RequirementResult][] = group.flatMap((item) =>
      item.fix!.add.map((source) => [item, checkRequirement(parsed, { type: item.violation.type, source, reason: '' }, origin)] as [ExplainedViolation, RequirementResult]),
    );
    const blocked = results.filter(([, r]) => r.verdict === 'blocked');
    for (const [item] of blocked) item.fix!.inLines = true;
    const patch = buildPatches(parsed, blocked.map(([, r]) => r), origin)[0];
    for (const change of patch?.changes ?? []) {
      lines.push({ directive: change.directive, created: change.created, line: change.after, reportOnly, policy: value });
    }
    if (patch && patch.changes.length > 0) fixed.push({ before: value, after: patch.after, reportOnly });
  }
  return { lines, fixed };
}

const parsedOf = (value: string): ParseResult => ({ input: value, policies: [parseSinglePolicy(value)], issues: [] });

/** The rule with the weaker value in it, on its own; or `ignored`, when a nonce or a hash makes browsers ignore it. */
function weakerLine(weaker: WeakerFix, item: ExplainedViolation, origin: string) {
  const value = item.violation.value!;
  const policy = parseSinglePolicy(value);
  if (weaker.risk === 'style-attr' || weaker.risk === 'handler') {
    weaker.line = ATTR_LINE[weaker.risk];
    weaker.created = !policy.directives.some((d) => d.name === weaker.directive);
    return;
  }
  const type = weaker.risk === 'scheme' ? item.violation.type : WEAKER_TYPE[weaker.risk];
  const result = checkRequirement(parsedOf(value), { type, source: weaker.add[0]!, reason: '' }, origin);
  if (result.verdict === 'allowed') return;
  const change = result.verdict === 'blocked' ? buildPatches(parsedOf(value), [result], origin)[0]?.changes[0] : undefined;
  if (!change) {
    weaker.ignored = true;
    return;
  }
  weaker.line = change.after;
  weaker.directive = change.directive;
  weaker.created = change.created;
}
