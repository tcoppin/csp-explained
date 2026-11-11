import type { Audience } from '../../lib/csp/model';
import { decodeVendors, encodeVendors, fromBase64Url, isAudience, toBase64Url } from './state';

/**
 * The comparison's state, kept in the URL fragment like the analyzer's: never sent to a server. The analyzer and the
 * builder write it too, to open the comparator on their policy.
 * `b` and `a` hold the two policies, `s` the site, `v` the tools, `t` the view and `r` the reader (audience).
 */
export const COMPARE_VIEWS = ['changes', 'diff', 'security', 'tools'] as const;
export type CompareView = (typeof COMPARE_VIEWS)[number];

export interface CompareState {
  before: string;
  after: string;
  site: string;
  /** vendor id → selected feature ids */
  vendors: Record<string, string[]>;
  view?: CompareView;
  audience?: Audience;
}

const isView = (v: string | null): v is CompareView => (COMPARE_VIEWS as readonly (string | null)[]).includes(v);

export function encodeCompareState(s: CompareState): string {
  const params = new URLSearchParams();
  if (s.before) params.set('b', toBase64Url(s.before));
  if (s.after) params.set('a', toBase64Url(s.after));
  if (s.site) params.set('s', s.site);
  const vendors = encodeVendors(s.vendors);
  if (vendors) params.set('v', vendors);
  const hasPolicy = s.before !== '' || s.after !== '';
  if (hasPolicy && s.view && s.view !== 'changes') params.set('t', s.view);
  if (hasPolicy && s.audience && s.audience !== 'simple') params.set('r', s.audience);
  return params.toString();
}

export function decodeCompareState(hash: string): Partial<CompareState> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<CompareState> = {};
  for (const [key, field] of [
    ['b', 'before'],
    ['a', 'after'],
  ] as const) {
    try {
      const value = params.get(key);
      if (value) out[field] = fromBase64Url(value);
    } catch {
      // Malformed link: ignore that policy.
    }
  }
  const s = params.get('s');
  if (s) out.site = s;
  const v = params.get('v');
  if (v) out.vendors = decodeVendors(v);
  const view = params.get('t');
  if (isView(view)) out.view = view;
  const audience = params.get('r');
  if (isAudience(audience)) out.audience = audience;
  return out;
}
