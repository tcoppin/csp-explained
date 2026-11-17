import { addressOf, sourceMatchesAddress } from './catalogue/lookup';
import { requirementsOf } from './catalogue/requirements';
import type { Feature, Vendor } from './catalogue/schema';
import { checkRequirement } from './csp/compat';
import { CANONICAL_DIRECTIVE, type ResourceType } from './csp/directives';
import type { ParseResult } from './csp/model';
import { parseSinglePolicy } from './csp/parser';
import { buildPatches } from './csp/patch';
import { parseViolations, type Violation } from './csp/violation';

/** Placeholder for the visitor's site, as in the analysis ('self' only). */
const ORIGIN = 'https://your-site.example';

/**
 * What a console message is about, which decides what we can offer:
 * - `address`: something loaded from an address: the tool behind it and the line to allow it;
 * - `extension`: a browser extension of the person who saw the message: nothing to change in the policy;
 * - `inline`: a `<script>` or `<style>` block: its hash when the browser gave it, otherwise how to get one;
 * - `style-attr`: a `style="…"` attribute: its own rule, which keeps scripts protected;
 * - `handler`: an `onclick="…"` attribute: the code has to move, the policy can't allow it safely;
 * - `eval`: code built from text: `'unsafe-eval'`, with what it costs;
 * - `ancestors`: another site's page refused to be shown in a frame of this one: only that site can change it.
 */
export type ViolationCase = 'address' | 'extension' | 'inline' | 'style-attr' | 'handler' | 'eval' | 'ancestors';

export interface ToolUse {
  vendor: Vendor;
  feature: Feature;
  /** The value the vendor documents, which covers the blocked address. */
  source: string;
}

export interface ViolationFix {
  /** The value to add. */
  add: string;
  /** The rule it goes in. */
  directive: string;
  /** The rule doesn't exist yet (the browser fell back to default-src): it is created from default-src's values. */
  created: boolean;
  /** The whole rule once changed, when the browser quoted it. */
  line?: string;
  /** The value weakens the policy ('unsafe-eval', data: or blob: for scripts): say what it costs. */
  risky: boolean;
}

export interface ExplainedViolation {
  violation: Violation;
  case: ViolationCase;
  /** The blocked address's host (or scheme, for data: and blob:). */
  host?: string;
  /** Catalogue tools that use the blocked address, or that are known to need what was blocked (eval). */
  tools: ToolUse[];
  fix?: ViolationFix;
}

const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:/i;
const LOCAL_SCHEME = /^(blob|data|filesystem):/i;

/** Every policy message in `input`, explained with the catalogue. */
export function explainViolations(input: string, vendors: Vendor[]): ExplainedViolation[] {
  return parseViolations(input).map((v) => explain(v, vendors));
}

export function explain(v: Violation, vendors: Vendor[]): ExplainedViolation {
  if (v.directive === 'frame-ancestors') return { violation: v, case: 'ancestors', tools: [] };
  switch (v.kind) {
    case 'inline-handler':
      return { violation: v, case: 'handler', tools: [] };
    case 'style-attr':
      return {
        violation: v,
        case: 'style-attr',
        tools: [],
        fix: { add: "'unsafe-inline'", directive: 'style-src-attr', created: v.directive !== 'style-src-attr', line: "style-src-attr 'unsafe-inline'", risky: false },
      };
    case 'inline-script':
    case 'inline-style':
      return { violation: v, case: 'inline', tools: [], ...(v.hash ? { fix: fixFor(v, v.type, v.hash) } : {}) };
    case 'eval':
      return { violation: v, case: 'eval', tools: usesOf(vendors, (r) => r.type === 'eval'), fix: fixFor(v, 'eval', "'unsafe-eval'") };
    case 'url':
      return explainAddress(v, vendors);
  }
}

function explainAddress(v: Violation, vendors: Vendor[]): ExplainedViolation {
  const raw = v.url!;
  if (EXTENSION.test(raw)) return { violation: v, case: 'extension', host: raw.split('/')[2] ?? raw, tools: [] };
  const local = LOCAL_SCHEME.exec(raw);
  if (local) return { violation: v, case: 'address', host: `${local[1]!.toLowerCase()}:`, tools: [], fix: fixFor(v, v.type, `${local[1]!.toLowerCase()}:`) };

  const address = addressOf(raw);
  if (!address) return { violation: v, case: 'address', tools: [] };
  const all = usesOf(vendors, (r) => sourceMatchesAddress(r.source, address) === 'exact');
  // The tool's own line for this kind of resource first: it is what the fix adds.
  const sameKind = usesOf(vendors, (r) => sourceMatchesAddress(r.source, address) === 'exact' && CANONICAL_DIRECTIVE[r.type] === CANONICAL_DIRECTIVE[v.type]);
  const tools = sameKind.length > 0 ? sameKind : all;
  const add = sameKind[0]?.source ?? address.origin;
  return { violation: v, case: 'address', host: address.host, tools, fix: fixFor(v, v.type, add) };
}

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

/**
 * The value to add and where. When the browser quoted the rule, the change is computed on it the way the analyzer
 * does: a rule that fell back to default-src gets its own rule (copying default-src) instead of widening default-src.
 */
function fixFor(v: Violation, type: ResourceType, add: string): ViolationFix {
  const risky = add === "'unsafe-eval'" || (/^(?:data|blob):$/.test(add) && (type === 'script' || type === 'worker'));
  const fallback: ViolationFix = {
    add,
    directive: v.directive && v.directive !== 'default-src' ? v.directive : CANONICAL_DIRECTIVE[type],
    created: v.directive === 'default-src',
    risky,
  };
  if (!v.value) return fallback;

  const parsed: ParseResult = { input: v.value, policies: [parseSinglePolicy(v.value)], issues: [] };
  const result = checkRequirement(parsed, { type, source: add, reason: '' }, ORIGIN);
  const change = result.verdict === 'blocked' ? buildPatches(parsed, [result], ORIGIN)[0]?.changes[0] : undefined;
  if (!change) return fallback;
  return { add, directive: change.directive, created: change.created, line: change.after, risky };
}
