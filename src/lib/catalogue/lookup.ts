import { expressionMatchesUrl } from '../csp/matcher';
import { parseHostSource } from '../csp/parser';

/** Stands for the visitor's own site: catalogue sources are matched as if on a page served over https. */
const SELF = 'https://your-site.invalid';

/**
 * What was typed, read as an address to look up: `static.hotjar.com`, `https://region1.google-analytics.com/g/collect`,
 * or a value copied from a console message, quotes and final punctuation included. Undefined for anything else (a
 * tool's name), so the same field can search both.
 */
export function addressOf(query: string): URL | undefined {
  let q = query.trim().replace(/^['"‘“<(]+|['"’”>).,;:]+$/g, '');
  if (!q || /\s/.test(q) || !q.includes('.')) return undefined;
  if (q.startsWith('//')) q = `https:${q}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(q)) q = `https://${q}`;
  try {
    const url = new URL(q);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How a catalogue source relates to an address:
 * - `exact`: a policy with this source lets the browser load the address (the path is left out: people often type
 *   a host alone);
 * - `domain`: the source names another host under the typed one (`google.com` typed, `www.google.com` listed), or
 *   the same host on another scheme or port;
 * - undefined: unrelated, or not an address at all (`'self'`, `'unsafe-inline'`, `blob:`).
 */
export function sourceMatchesAddress(source: string, address: URL): 'exact' | 'domain' | undefined {
  const parts = parseHostSource(source);
  if (!parts || parts.host === '*' || !parts.host.includes('.')) return undefined;
  const host = { ...parts, path: undefined };
  const expression = { raw: source, kind: 'host' as const, value: source.toLowerCase(), span: { start: 0, end: 0 }, host };
  if (expressionMatchesUrl(expression, address.href, SELF)) return 'exact';
  const listed = parts.host.replace(/^\*\./, '').replace(/\.$/, '');
  const typed = address.hostname;
  return listed === typed || listed.endsWith(`.${typed}`) ? 'domain' : undefined;
}
