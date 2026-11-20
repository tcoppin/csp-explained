/**
 * Reads the violation reports browsers send to a policy's `report-to` or `report-uri` endpoint, as a collector
 * stores them: the Reporting API's `{ type: 'csp-violation', body: { … } }` (one or an array), the older
 * `{ "csp-report": { … } }`, one per line, inside log lines, or wrapped by a collector's own fields.
 *
 * Shapes taken from the browsers themselves (Chromium, Firefox and WebKit, 2026, `violation-reports/`), except
 * Chromium's Reporting API reports, which it didn't deliver to a local server: those follow the specification and
 * MDN, which Firefox and WebKit match.
 */

export interface ViolationReport {
  /** The page the report came from, as sent (query string included). */
  page?: string;
  /** What was blocked, as sent: an address, or `inline`, `eval`, `wasm-eval`, `trusted-types-sink`… */
  blocked: string;
  /** The rule meant for what was blocked (`script-src-elem`), before any fallback. */
  directive: string;
  /** The whole policy the browser applied. */
  policy?: string;
  /** `report` for a report-only policy. */
  disposition: 'enforce' | 'report';
  /** The browser didn't say (Safari's older format), nor did any other report under the same policy: taken as enforced. */
  guessed?: true;
  /** The file whose code caused it, when the browser says. */
  sourceFile?: string;
  /** The start of the blocked code (`'report-sample'`), at most 40 characters. */
  sample?: string;
  /** The browser, when the report or its collector kept it. */
  userAgent?: string;
}

export interface ReadReports {
  reports: ViolationReport[];
  /** Lines with JSON that wasn't a CSP report (other kinds of reports, other logs). */
  skipped: number;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: Json | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);

/** The fields of one report, in either spelling. */
type Read = Omit<ViolationReport, 'disposition'> & { disposition?: 'enforce' | 'report' };

function fromBody(body: Obj, around: Obj[]): Read | undefined {
  const field = (modern: string, legacy: string) => str(body[modern]) ?? str(body[legacy]);
  const directive = field('effectiveDirective', 'effective-directive') ?? field('violatedDirective', 'violated-directive')?.split(' ')[0];
  if (!directive) return undefined;
  const blocked = typeof body.blockedURL === 'string' ? body.blockedURL : typeof body['blocked-uri'] === 'string' ? (body['blocked-uri'] as string) : undefined;
  if (blocked === undefined) return undefined;
  const disposition = field('disposition', 'disposition');
  // The browser is beside the body (Reporting API), or kept by the collector, at any level around it.
  const userAgent = [body, ...around].map((o) => str(o.user_agent) ?? str(o.userAgent) ?? str(o['user-agent']) ?? str(o.ua)).find((v) => v);
  const page = field('documentURL', 'document-uri');
  const policy = field('originalPolicy', 'original-policy');
  const sourceFile = field('sourceFile', 'source-file');
  const sample = field('sample', 'script-sample');
  return {
    blocked: blocked.trim(),
    directive: directive.toLowerCase(),
    ...(page ? { page } : {}),
    ...(policy ? { policy: policy.trim() } : {}),
    ...(disposition === 'enforce' || disposition === 'report' ? { disposition } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    ...(sample ? { sample } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

const looksLikeReport = (o: Obj) =>
  ('blockedURL' in o || 'blocked-uri' in o) && ('effectiveDirective' in o || 'effective-directive' in o || 'violated-directive' in o || 'violatedDirective' in o);

/** Every report in a JSON value, however deep a collector wrapped it (strings holding JSON included). */
function collect(value: Json, around: Obj[], out: Read[]) {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, around, out);
    return;
  }
  if (typeof value === 'string') {
    const inner = parseJson(value);
    if (inner !== undefined) collect(inner, around, out);
    return;
  }
  if (!isObj(value)) return;
  if (looksLikeReport(value)) {
    const report = fromBody(value, around);
    if (report) out.push(report);
    return;
  }
  // Reports of other kinds (deprecation, intervention…) are left out.
  if (typeof value.type === 'string' && value.type !== 'csp-violation' && isObj(value.body)) return;
  for (const v of Object.values(value)) collect(v, [value, ...around], out);
}

function parseJson(text: string): Json | undefined {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return undefined;
  try {
    return JSON.parse(t) as Json;
  } catch {
    return undefined;
  }
}

/** The reports in what was pasted or opened: a JSON document, or lines that each hold one (log lines included). */
export function readReports(input: string): ReadReports {
  const reports: Read[] = [];
  const whole = parseJson(input);
  if (whole !== undefined) {
    collect(whole, [], reports);
    return { reports: withDisposition(reports), skipped: 0 };
  }
  let skipped = 0;
  // One JSON value per line (a collector's log), sometimes after a timestamp or a log level.
  for (const line of input.split(/\r?\n/)) {
    const start = line.search(/[[{]/);
    if (start < 0) continue;
    const value = parseJson(line.slice(start));
    if (value === undefined) {
      if (line.trim() !== '') skipped++;
      continue;
    }
    const before = reports.length;
    collect(value, [], reports);
    if (reports.length === before) skipped++;
  }
  // A JSON document spread over several lines that isn't valid as a whole (a pasted part of an array): read it
  // object by object.
  if (reports.length === 0) {
    for (const value of objectsIn(input)) collect(value, [], reports);
    if (reports.length > 0) skipped = 0;
  }
  return { reports: withDisposition(reports), skipped };
}

/** The top-level `{…}` objects in text that isn't valid JSON as a whole. */
function* objectsIn(text: string): Generator<Json> {
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = depth > 0;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        const value = parseJson(text.slice(start, i + 1));
        if (value !== undefined) yield value;
      }
    }
  }
}

/**
 * Safari's older reports don't say whether the policy was enforced. Another report under the same policy text
 * does; when none does, the report is taken as enforced, as is the most common.
 */
function withDisposition(reports: Read[]): ViolationReport[] {
  const known = new Map<string, 'enforce' | 'report'>();
  for (const r of reports) if (r.policy && r.disposition) known.set(r.policy, r.disposition);
  return reports.map((r) => {
    if (r.disposition) return { ...r, disposition: r.disposition };
    const found = r.policy ? known.get(r.policy) : undefined;
    return found ? { ...r, disposition: found } : { ...r, disposition: 'enforce', guessed: true };
  });
}

/** The browser's name from its user agent, for grouping reports: brand names, never translated. */
export function browserOf(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/\b(?:OPR|Opera)\//.test(userAgent)) return 'Opera';
  if (/\bSamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return 'Firefox';
  if (/\b(?:Chrome|CriOS|Chromium|HeadlessChrome)\//.test(userAgent)) return 'Chrome';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(userAgent) || /AppleWebKit/.test(userAgent)) return 'Safari';
  return undefined;
}
