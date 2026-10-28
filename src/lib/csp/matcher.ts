import { EFFECTIVE_DIRECTIVE, type ResourceType } from './directives';
import { resolve } from './fallback';
import type { Directive, HostParts, Policy, SourceExpression } from './model';

/** Implements the matching algorithms of CSP Level 3 §6.7 for a single URL. */

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };
const NETWORK_SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp']);

interface ParsedUrl {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

function parseUrl(url: string): ParsedUrl | undefined {
  try {
    const u = new URL(url);
    const scheme = u.protocol.slice(0, -1);
    return { scheme, host: u.hostname.toLowerCase(), port: u.port || DEFAULT_PORTS[scheme] || '', path: u.pathname };
  } catch {
    return undefined;
  }
}

/** CSP3 "scheme-part match": http upgrades to https, ws to wss/http/https, wss to https. */
function schemeMatches(expr: string, url: string): boolean {
  if (expr === url) return true;
  if (expr === 'http' && url === 'https') return true;
  if (expr === 'ws' && (url === 'wss' || url === 'http' || url === 'https')) return true;
  if (expr === 'wss' && url === 'https') return true;
  return false;
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
  return pattern === host;
}

function portMatches(exprPort: string | undefined, exprScheme: string | undefined, url: ParsedUrl): boolean {
  if (exprPort === '*') return true;
  const urlPort = url.port;
  if (exprPort === undefined) return urlPort === (DEFAULT_PORTS[url.scheme] ?? '');
  if (exprPort === urlPort) return true;
  // http://host:80 also allows the upgraded https://host:443.
  return exprPort === '80' && urlPort === '443' && (exprScheme === undefined || exprScheme === 'http') && url.scheme === 'https';
}

function pathMatches(exprPath: string | undefined, urlPath: string): boolean {
  if (!exprPath || exprPath === '/') return true;
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const e = decode(exprPath);
  const u = decode(urlPath);
  return e.endsWith('/') ? u.startsWith(e) : u === e;
}

function hostSourceMatches(h: HostParts, url: ParsedUrl, self: ParsedUrl): boolean {
  if (h.scheme) {
    if (!schemeMatches(h.scheme, url.scheme)) return false;
  } else if (h.host === '*') {
    // A lone `*` matches network schemes and the page's own scheme, never data:, blob:, …
    if (!NETWORK_SCHEMES.has(url.scheme) && url.scheme !== self.scheme) return false;
  } else if (!schemeMatches(self.scheme, url.scheme)) {
    return false;
  }
  return hostMatches(h.host, url.host) && portMatches(h.port, h.scheme, url) && pathMatches(h.path, url.path);
}

function selfMatches(url: ParsedUrl, self: ParsedUrl): boolean {
  if (url.host !== self.host) return false;
  const sameScheme = url.scheme === self.scheme;
  const upgrade =
    (self.scheme === 'http' && ['https', 'ws', 'wss'].includes(url.scheme)) ||
    (self.scheme === 'https' && url.scheme === 'wss');
  if (!sameScheme && !upgrade) return false;
  return url.port === self.port || (upgrade && url.port === DEFAULT_PORTS[url.scheme]);
}

/** Does `url` match one source expression, for a page served from `selfOrigin`? */
export function expressionMatchesUrl(expr: SourceExpression, url: string, selfOrigin: string): boolean {
  const u = parseUrl(url);
  const s = parseUrl(selfOrigin);
  if (!u || !s) return false;
  switch (expr.kind) {
    case 'scheme':
      return schemeMatches(expr.value.slice(0, -1), u.scheme);
    case 'host':
      return expr.host ? hostSourceMatches(expr.host, u, s) : false;
    case 'keyword':
      return expr.value === "'self'" && selfMatches(u, s);
    default:
      return false;
  }
}

export type Verdict =
  /** The load or behaviour is allowed. */
  | 'allowed'
  /** Blocked by the policy. */
  | 'blocked'
  /**
   * Host allowlisting does not help: the policy relies on nonces/hashes
   * ('strict-dynamic', or inline code with a nonce present). The site must pass its nonce on.
   */
  | 'needs-nonce';

export interface MatchResult {
  verdict: Verdict;
  /** The directive that took the decision (undefined when nothing restricts the resource). */
  directive?: Directive;
  /** The effective directive the browser looked for first. */
  requested: string;
  /** Source expression that allowed it. */
  matchedBy?: SourceExpression;
  /** Sources present but ignored by the browser (e.g. hosts with 'strict-dynamic'). */
  ignored: SourceExpression[];
}

const has = (d: Directive, keyword: string) => d.values.some((v) => v.kind === 'keyword' && v.value === keyword);
const hasNonceOrHash = (d: Directive) => d.values.some((v) => v.kind === 'nonce' || v.kind === 'hash');

const SCRIPT_DIRECTIVES = new Set(['script-src', 'script-src-elem', 'script-src-attr', 'default-src']);
const STYLE_DIRECTIVES = new Set(['style-src', 'style-src-elem', 'style-src-attr', 'default-src']);

/**
 * Would a single policy let the page load `url` as `type`?
 * For inline/eval types the URL is ignored.
 */
export function checkResource(policy: Policy, type: ResourceType, url: string | undefined, selfOrigin: string): MatchResult {
  const requested = EFFECTIVE_DIRECTIVE[type];
  const { governing } = resolve(policy, requested);
  if (!governing) return { verdict: 'allowed', requested, ignored: [] };

  const scriptLike = SCRIPT_DIRECTIVES.has(governing.name) && (type === 'script' || type === 'inline-script' || type === 'inline-handler' || type === 'eval' || type === 'worker');
  const styleLike = STYLE_DIRECTIVES.has(governing.name) && (type === 'style' || type === 'inline-style' || type === 'style-attr');
  const strictDynamic = scriptLike && has(governing, "'strict-dynamic'");
  const nonceOrHash = (scriptLike || styleLike) && hasNonceOrHash(governing);

  const base = { requested, directive: governing };

  if (type === 'eval') {
    const kw = governing.values.find((v) => v.kind === 'keyword' && v.value === "'unsafe-eval'");
    return kw ? { ...base, verdict: 'allowed', matchedBy: kw, ignored: [] } : { ...base, verdict: 'blocked', ignored: [] };
  }

  if (type === 'inline-script' || type === 'inline-handler' || type === 'inline-style' || type === 'style-attr') {
    const unsafeInline = governing.values.find((v) => v.kind === 'keyword' && v.value === "'unsafe-inline'");
    if (unsafeInline && !nonceOrHash && !strictDynamic) {
      return { ...base, verdict: 'allowed', matchedBy: unsafeInline, ignored: [] };
    }
    // 'unsafe-inline' is ignored when a nonce, a hash or 'strict-dynamic' is present.
    const ignored = unsafeInline ? [unsafeInline] : [];
    // Inline <script>/<style> blocks can carry the nonce; event handlers and style attributes cannot.
    if ((type === 'inline-script' || type === 'inline-style') && (nonceOrHash || strictDynamic)) {
      return { ...base, verdict: 'needs-nonce', ignored };
    }
    return { ...base, verdict: 'blocked', ignored };
  }

  if (!url) return { ...base, verdict: 'blocked', ignored: [] };

  if (strictDynamic) {
    // Hosts, schemes, 'self' and 'unsafe-inline' are all ignored: only nonced/hashed scripts
    // and scripts they load themselves are allowed.
    const ignored = governing.values.filter((v) => v.kind === 'host' || v.kind === 'scheme' || (v.kind === 'keyword' && (v.value === "'self'" || v.value === "'unsafe-inline'")));
    return { ...base, verdict: 'needs-nonce', ignored };
  }

  const matchedBy = governing.values.find((v) => expressionMatchesUrl(v, url, selfOrigin));
  if (matchedBy) return { ...base, verdict: 'allowed', matchedBy, ignored: [] };
  return { ...base, verdict: 'blocked', ignored: [] };
}
