/**
 * What our own policy blocks on this site, seen by the visitor's browser and counted at `/csp-violation`.
 *
 * Browsers ignore `report-uri` and `report-to` in a `<meta>` policy, and ours is in a `<meta>` tag (see
 * src/site-policy.ts). So a script first in every page (src/layouts/Base.astro) listens for the
 * `securitypolicyviolation` event and sends a short summary here, as a GET query string like the usage counts:
 * `d` the directive, `b` what was blocked, `s` the file that tried, `l` its line, `p` the page's path.
 * Never a code sample, never a query string: either could hold what the visitor typed.
 *
 * The endpoint is public, so the Lambda (infra/lambda/violations.ts) checks everything again here.
 */

export const VIOLATION_NAMESPACE = 'CspExplained/Violations';

/** `script` when something tried to run code (what the alarm watches), `other` for images, styles, requests… */
export type ViolationKind = 'script' | 'other';

export interface ViolationRecord {
  kind: ViolationKind;
  directive: string;
  blocked: string;
  source: string;
  line?: number;
  page: string;
}

/** What browsers write in place of an address for code that isn't a file. */
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;
const PAGE = /^\/[A-Za-z0-9/._-]{0,120}$/;
const MAX_ADDRESS = 200;

/** Violations caused by the visitor's browser extensions: nothing to do with our pages. */
export const isExtension = (value: string) => /^[a-z-]*extension:/i.test(value);

/** An address cut to its origin and path (no query, no fragment); other schemes to the scheme alone. */
export function shortAddress(value: string): string | undefined {
  if (value === '') return '';
  if (KEYWORDS.has(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.origin}${url.pathname}`.slice(0, MAX_ADDRESS);
  return /^[a-z][a-z0-9+.-]{0,30}:$/.test(url.protocol) ? url.protocol : undefined;
}

export function violationKind(directive: string): ViolationKind {
  return directive.startsWith('script-src') || directive === 'worker-src' || directive.includes('trusted-types') ? 'script' : 'other';
}

/** Reads a request's query string, or undefined if it isn't a violation we keep (unreadable, or an extension's). */
export function violationRecord(query: Record<string, string | undefined>): ViolationRecord | undefined {
  const { d: directive = '', b = '', s = '', l, p: page = '' } = query;
  if (!DIRECTIVE.test(directive) || !PAGE.test(page)) return undefined;
  if (isExtension(b) || isExtension(s)) return undefined;
  const blocked = shortAddress(b);
  const source = shortAddress(s);
  if (blocked === undefined || source === undefined || KEYWORDS.has(source)) return undefined;
  const record: ViolationRecord = { kind: violationKind(directive), directive, blocked, source, page };
  if (l && /^\d{1,7}$/.test(l)) record.line = Number(l);
  return record;
}

/**
 * One log line in CloudWatch embedded metric format: a `Violations` metric per kind (two metrics), and the
 * details for the Logs Insights tables on the dashboard.
 */
export function violationLogLine(record: ViolationRecord, timestamp: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{ Namespace: VIOLATION_NAMESPACE, Dimensions: [['Kind']], Metrics: [{ Name: 'Violations', Unit: 'Count' }] }],
    },
    Kind: record.kind,
    Violations: 1,
    Directive: record.directive,
    Blocked: record.blocked,
    Source: record.source,
    ...(record.line !== undefined ? { Line: record.line } : {}),
    Page: record.page,
  });
}
