import type { Audience } from '../lib/csp/model';

/**
 * Shareable state lives in the URL fragment (#…), which browsers never send to servers,
 * so a shared link keeps the "nothing leaves your browser" promise.
 */
export interface ShareState {
  policy: string;
  site: string;
  /** vendor id → selected feature ids */
  vendors: Record<string, string[]>;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeState(s: ShareState): string {
  const params = new URLSearchParams();
  if (s.policy) params.set('p', toBase64Url(s.policy));
  if (s.site) params.set('s', s.site);
  const vendors = Object.entries(s.vendors)
    .map(([id, features]) => `${id}:${features.join('+')}`)
    .join(',');
  if (vendors) params.set('v', vendors);
  return params.toString();
}

export function decodeState(hash: string): Partial<ShareState> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<ShareState> = {};
  try {
    const p = params.get('p');
    if (p) out.policy = fromBase64Url(p);
  } catch {
    // Malformed link: ignore the policy part.
  }
  const s = params.get('s');
  if (s) out.site = s;
  const v = params.get('v');
  if (v) {
    out.vendors = Object.fromEntries(
      v.split(',').map((entry) => {
        const [id = '', features = ''] = entry.split(':');
        return [id, features.split('+').filter(Boolean)];
      }),
    );
  }
  return out;
}

const AUDIENCE_KEY = 'csp-explained:audience';

export function loadAudience(): Audience {
  try {
    const v = localStorage.getItem(AUDIENCE_KEY);
    if (v === 'simple' || v === 'developer' || v === 'security') return v;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return 'simple';
}

export function saveAudience(a: Audience): void {
  try {
    localStorage.setItem(AUDIENCE_KEY, a);
  } catch {
    // Not critical.
  }
}

/** Turns "shop.example.com" or "https://shop.example.com/path" into an origin. */
export function toOrigin(site: string): string | undefined {
  const s = site.trim();
  if (!s) return undefined;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).origin;
  } catch {
    return undefined;
  }
}
