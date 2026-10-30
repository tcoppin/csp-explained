import { SITE_NEEDS, type BaselineMode, type CustomTool, type SiteNeed } from '../lib/build';
import { EFFECTIVE_DIRECTIVE, type ResourceType } from '../lib/csp/directives';
import type { Audience } from '../lib/csp/model';
import { decodeVendors, encodeVendors, fromBase64Url, isAudience, toBase64Url } from './state';

/**
 * The builder's link, in the URL fragment like the analyzer's. Shares `p`, `s`, `v` and `a` with it, so a
 * policy and its tools can go from one page to the other.
 */
export const STEPS = ['start', 'site', 'tools', 'review'] as const;
export type Step = (typeof STEPS)[number];

/** From nothing (one of two baselines), or from a policy the visitor already has. */
export type Start = BaselineMode | 'policy';

export interface BuildState {
  start?: Start;
  /** The existing policy, when starting from one. */
  policy: string;
  site: string;
  needs: SiteNeed[];
  vendors: Record<string, string[]>;
  tools: CustomTool[];
  step?: Step;
  audience?: Audience;
}

const isStart = (v: string | null): v is Start => v === 'allowlist' || v === 'nonce' || v === 'policy';
const isStep = (v: string | null): v is Step => (STEPS as readonly (string | null)[]).includes(v);
const isNeed = (v: string): v is SiteNeed => v in SITE_NEEDS;
const isType = (v: unknown): v is ResourceType => typeof v === 'string' && v in EFFECTIVE_DIRECTIVE;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Compact form: `[name, [[type, [sources]], …]]`. The id is rebuilt from the position. */
type PackedTool = [string, [string, string[]][]];

const pack = (tools: CustomTool[]): PackedTool[] => tools.map((t) => [t.name, t.needs.map((n) => [n.type, n.sources])]);

/** Keeps what makes sense in a tool list that came from a link or from storage, drops the rest. */
export function unpackTools(value: unknown): CustomTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, i): CustomTool[] => {
    if (!Array.isArray(entry) || !isText(entry[0]) || !Array.isArray(entry[1])) return [];
    const needs = (entry[1] as unknown[]).flatMap((n) =>
      Array.isArray(n) && isType(n[0]) && Array.isArray(n[1]) ? [{ type: n[0], sources: n[1].filter(isText) }] : [],
    );
    return [{ id: `own-${i + 1}`, name: entry[0].slice(0, 80), needs }];
  });
}

export function encodeBuildState(s: BuildState): string {
  const params = new URLSearchParams();
  if (s.start) params.set('b', s.start);
  if (s.start === 'policy' && s.policy) params.set('p', toBase64Url(s.policy));
  if (s.site) params.set('s', s.site);
  if (s.needs.length > 0) params.set('n', s.needs.join(','));
  const vendors = encodeVendors(s.vendors);
  if (vendors) params.set('v', vendors);
  if (s.tools.length > 0) params.set('c', toBase64Url(JSON.stringify(pack(s.tools))));
  if (s.step && s.step !== 'start') params.set('step', s.step);
  if (s.audience && s.audience !== 'simple') params.set('a', s.audience);
  return params.toString();
}

export function decodeBuildState(hash: string): Partial<BuildState> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<BuildState> = {};
  const p = params.get('p');
  try {
    if (p) out.policy = fromBase64Url(p);
  } catch {
    // Malformed link: ignore the policy part.
  }
  const start = params.get('b');
  // A policy alone comes from the analyzer: build on it.
  if (isStart(start)) out.start = start;
  else if (out.policy) out.start = 'policy';
  const s = params.get('s');
  if (s) out.site = s;
  const n = params.get('n');
  if (n) out.needs = n.split(',').filter(isNeed);
  const v = params.get('v');
  if (v) out.vendors = decodeVendors(v);
  const c = params.get('c');
  try {
    if (c) out.tools = unpackTools(JSON.parse(fromBase64Url(c)));
  } catch {
    // Malformed link: ignore the tools.
  }
  const step = params.get('step');
  if (isStep(step)) out.step = step;
  const audience = params.get('a');
  if (isAudience(audience)) out.audience = audience;
  return out;
}

const TOOLS_KEY = 'csp-explained:tools';

/** Own tools remembered in this browser only, to reuse them in another policy. */
export function loadTools(): CustomTool[] {
  try {
    const raw = localStorage.getItem(TOOLS_KEY);
    return raw ? unpackTools(JSON.parse(raw)) : [];
  } catch {
    // Storage can be unavailable (private mode, blocked site data), or hold something we can't read.
    return [];
  }
}

export function saveTools(tools: CustomTool[]): void {
  try {
    if (tools.length > 0) localStorage.setItem(TOOLS_KEY, JSON.stringify(pack(tools)));
    else localStorage.removeItem(TOOLS_KEY);
  } catch {
    // Not critical.
  }
}
