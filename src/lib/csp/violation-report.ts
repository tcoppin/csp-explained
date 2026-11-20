/**
 * Reads the violation reports browsers send to a policy's `report-to` or `report-uri` endpoint, as a collector
 * stores them: the Reporting API's `{ type: 'csp-violation', body: { … } }` (one or an array), the older
 * `{ "csp-report": { … } }`, one per line, inside log lines, or wrapped by a collector's own fields.
 *
 * Collector services (Sentry, Datadog, report-uri.com…) don't publish their export formats, so they are read by
 * their field names rather than by service: any spelling of a report's fields (`blocked-uri`, `blocked_uri`,
 * `blockedURL`, `@csp-report.blocked-uri`, `tags[blocked-uri]`), nested anywhere, in JSON or in a CSV or TSV
 * export with a header row.
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
  /**
   * When it was received (milliseconds since 1970), when the collector kept it: a field (`timestamp`, `date`,
   * `@timestamp`…), a CSV column, or the date that starts a log line. Browsers only say how old a report was when
   * sent (`age`), which says nothing without the time it arrived.
   */
  time?: number;
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

type Field = 'blocked' | 'effective' | 'violated' | 'page' | 'policy' | 'disposition' | 'sourceFile' | 'sample' | 'userAgent' | 'time';

/** A report's fields by their name without case or separators: the browsers' own spellings and collectors' ones. */
const FIELDS: Record<string, Field> = {
  blockeduri: 'blocked',
  blockedurl: 'blocked',
  effectivedirective: 'effective',
  violateddirective: 'violated',
  documenturi: 'page',
  documenturl: 'page',
  originalpolicy: 'policy',
  disposition: 'disposition',
  sourcefile: 'sourceFile',
  sample: 'sample',
  scriptsample: 'sample',
  useragent: 'userAgent',
  ua: 'userAgent',
  timestamp: 'time',
  time: 'time',
  date: 'time',
  datetime: 'time',
  eventtime: 'time',
  receivedat: 'time',
  datereceived: 'time',
  datecreated: 'time',
  createdat: 'time',
};

/**
 * The field a key names: its last part (`@csp-report.blocked-uri`, `tags[blocked-uri]`, `csp/blocked_uri`), or
 * the part before it (`csp.blocked_uri.full`), without case or separators.
 */
function fieldOf(key: string): Field | undefined {
  const parts = key.split(/[.[\]/@]/).filter((p) => p !== '');
  for (const part of parts.slice(-2).reverse()) {
    const field = FIELDS[part.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (field) return field;
  }
  return undefined;
}

/** An object's fields that a report can have: the first value for each, when it is text (or a number, for a time). */
function fieldsOf(o: Obj): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const [key, raw] of Object.entries(o)) {
    const field = fieldOf(key);
    const value = field === 'time' && typeof raw === 'number' ? String(raw) : raw;
    // An empty blocked address means inline code in some browsers: kept.
    if (field && out[field] === undefined && typeof value === 'string' && (value !== '' || field === 'blocked')) out[field] = value;
  }
  return out;
}

const DISPOSITION: Record<string, 'enforce' | 'report'> = { enforce: 'enforce', enforced: 'enforce', report: 'report', reportonly: 'report' };

function fromBody(body: Obj, around: Obj[]): Read | undefined {
  const f = fieldsOf(body);
  const directive = f.effective ?? f.violated?.trim().split(/\s+/)[0];
  if (!directive || f.blocked === undefined) return undefined;
  const disposition = DISPOSITION[(f.disposition ?? '').toLowerCase().replace(/[^a-z]/g, '')];
  const time = [f.time, ...around.map((o) => fieldsOf(o).time)].map(timeOf).find((t) => t !== undefined);
  // The browser is beside the body (Reporting API), or kept by the collector, at any level around it or elsewhere in
  // its record (a request's headers).
  const userAgent = f.userAgent ?? around.map((o) => fieldsOf(o).userAgent).find((v) => v) ?? (around.length > 0 ? userAgentIn(around.at(-1)!, 4) : undefined);
  return {
    blocked: f.blocked.trim(),
    directive: directive.toLowerCase(),
    ...(f.page ? { page: f.page } : {}),
    ...(f.policy ? { policy: f.policy.trim() } : {}),
    ...(disposition ? { disposition } : {}),
    ...(f.sourceFile ? { sourceFile: f.sourceFile } : {}),
    ...(f.sample ? { sample: f.sample } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(time !== undefined ? { time } : {}),
  };
}

/** Earliest and latest times believed: anything else is a counter or a mistake, not a date. */
const EARLIEST = Date.UTC(2010, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);

/**
 * A time from a collector: seconds or milliseconds since 1970 (as a number or digits), or a date as text (ISO 8601,
 * `2026-11-20 10:00:00`, a log's `20/Nov/2026:10:00:00 +0000`). Without a time zone, the visitor's own.
 */
export function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  let t: number;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    t = n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
  } else {
    const clf = /^(\d{1,2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s*([+-]\d{4})?$/.exec(text);
    t = clf ? Date.parse(`${clf[2]} ${clf[1]} ${clf[3]} ${clf[4]} ${clf[5] ? `GMT${clf[5]}` : ''}`) : Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T'));
  }
  return Number.isFinite(t) && t >= EARLIEST && t < LATEST ? t : undefined;
}

/** The date that starts a log line (`2026-11-20T10:00:00Z INFO …`, `[20/Nov/2026:10:00:00 +0000] …`). */
function lineTime(prefix: string): number | undefined {
  const m = /^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?|\d{1,2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2}(?: [+-]\d{4})?)/.exec(prefix);
  return m ? timeOf(m[1]!.replace(',', '.')) : undefined;
}

/** A user agent anywhere in a record, a few levels deep (tag lists included). */
function userAgentIn(value: Json, depth: number): string | undefined {
  if (depth < 0) return undefined;
  if (Array.isArray(value)) {
    const tags = tagsOf(value);
    return tags ? userAgentIn(tags, depth) : value.map((v) => userAgentIn(v, depth - 1)).find((v) => v);
  }
  if (!isObj(value)) return undefined;
  return fieldsOf(value).userAgent ?? Object.values(value).map((v) => userAgentIn(v, depth - 1)).find((v) => v);
}

const looksLikeReport = (o: Obj) => {
  const fields = Object.keys(o).map(fieldOf);
  return fields.includes('blocked') && (fields.includes('effective') || fields.includes('violated'));
};

/** A list of tags (`[{ key, value }]` or `[[key, value]]`) as one object, when it is one. */
function tagsOf(list: Json[]): Obj | undefined {
  if (list.length === 0) return undefined;
  const pairs = list.map((t) =>
    Array.isArray(t) && t.length === 2 && typeof t[0] === 'string' ? ([t[0], t[1]!] as const) : isObj(t) && typeof t.key === 'string' && 'value' in t ? ([t.key, t.value!] as const) : undefined,
  );
  return pairs.every((p) => p !== undefined) ? Object.fromEntries(pairs) : undefined;
}

/** What makes two reports the same, to drop one a collector kept twice in a record (raw, and parsed). */
const sameAs = (r: Read) => [r.blocked, r.directive, r.page, r.policy, r.sample, r.sourceFile].join('\u0000');

/** Every report in a JSON value, however deep a collector wrapped it (strings holding JSON included). */
function collect(value: Json, around: Obj[], out: Read[]) {
  if (Array.isArray(value)) {
    const tags = tagsOf(value);
    if (tags) collect(tags, around, out);
    else for (const v of value) collect(v, around, out);
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
  // A collector can keep one report twice in a record: the raw text, and its fields parsed beside it. A branch
  // that only repeats what an earlier one held adds nothing.
  const seen = new Set<string>();
  for (const v of Object.values(value)) {
    const found: Read[] = [];
    collect(v, [value, ...around], found);
    if (found.length > 0 && found.every((r) => seen.has(sameAs(r)))) continue;
    for (const r of found) seen.add(sameAs(r));
    out.push(...found);
  }
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
  const table = readTable(input);
  if (table) {
    let skipped = 0;
    for (const row of table) {
      const before = reports.length;
      collect(row, [], reports);
      if (reports.length === before) skipped++;
    }
    if (reports.length > 0) return { reports: withDisposition(reports), skipped };
    reports.length = 0;
  }
  let skipped = 0;
  // One JSON value per line (a collector's log), sometimes after a timestamp or a log level.
  for (const line of input.split(/\r?\n/)) {
    const found = jsonIn(line);
    if (!found) continue;
    const { start, value } = found;
    if (value === undefined) {
      if (line.trim() !== '') skipped++;
      continue;
    }
    const before = reports.length;
    collect(value, [], reports);
    if (reports.length === before) skipped++;
    const time = lineTime(line.slice(0, start));
    if (time !== undefined) for (const r of reports.slice(before)) r.time ??= time;
  }
  // A JSON document spread over several lines that isn't valid as a whole (a pasted part of an array): read it
  // object by object.
  if (reports.length === 0) {
    for (const value of objectsIn(input)) collect(value, [], reports);
    if (reports.length > 0) skipped = 0;
  }
  return { reports: withDisposition(reports), skipped };
}

/**
 * The JSON a log line ends with, after whatever prefix (`[20/Nov/2026:10:00:00 +0000] {…}`): tried from each bracket
 * in turn. `value` is undefined when no bracket starts valid JSON; nothing when the line has no bracket.
 */
function jsonIn(line: string): { start: number; value: Json | undefined } | undefined {
  let first: number | undefined;
  for (let i = line.search(/[[{]/), tries = 0; i >= 0 && tries < 8; tries++) {
    first ??= i;
    const value = parseJson(line.slice(i));
    if (value !== undefined) return { start: i, value };
    const next = line.slice(i + 1).search(/[[{]/);
    i = next < 0 ? -1 : i + 1 + next;
  }
  return first === undefined ? undefined : { start: first, value: undefined };
}

/**
 * A CSV or TSV export: a header row, then one record per row, as objects keyed by the header (a cell may also hold
 * a whole report as JSON). Undefined when the first line isn't a header.
 */
function readTable(input: string): Obj[] | undefined {
  const firstLine = input.trimStart().split(/\r?\n/, 1)[0] ?? '';
  if (/^[[{]/.test(firstLine)) return undefined;
  const separator = ['\t', ',', ';'].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]!;
  if (separator[1] < 2) return undefined;
  const [header, ...rows] = rowsOf(input.trimStart(), separator[0]);
  if (!header || header.some((h) => h.trim() === '')) return undefined;
  return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** The cells of each row, with quoted cells (separators, doubled quotes and line breaks inside). */
function rowsOf(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === separator) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
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
