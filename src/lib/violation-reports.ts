import type { Vendor } from './catalogue/schema';
import { checkRequirement } from './csp/compat';
import { resolve } from './csp/fallback';
import { parseSinglePolicy } from './csp/parser';
import { DIRECTIVE_TYPE, trustedTypeOf, type BlockedKind, type Violation } from './csp/violation';
import { browserOf, readReports, type ReadReports, type ViolationReport } from './csp/violation-report';
import { explainItems, linesOf, type ExplainedViolation, type FixedPolicy, type PolicyLine } from './violations';

/**
 * Violation reports read together: grouped by what was blocked, under which rule and policy; each group explained
 * the way a console message is (the tool behind it, the line that allows it), with how many reports, pages and
 * browsers it stands for. What doesn't come from the site is set apart, by cause (`NoiseKind`).
 *
 * A report says something was blocked, not that it should be allowed: a script injected into the page, or a tool
 * that was hacked, is blocked the same way as a tool someone forgot. So an address no catalogue tool uses, outside
 * the site's own domain, is unknown: explained, but kept out of the lines until the visitor says they know it.
 *
 * When the collector kept dates, a batch tells a story: a policy whose last report came before the newest one's first
 * is an older version. Its reports are read against the newest policy: what it allows now is set apart (the change
 * worked), the rest are problems of the newest policy.
 */

/** One problem: reports about the same thing, under the same rule of the same policy. */
export interface ReportGroup {
  explained: ExplainedViolation;
  reports: number;
  /** The pages it happened on (address without its query string or `#` part), most reports first. */
  pages: { page: string; reports: number }[];
  /** The browsers that sent it, most reports first; reports without a browser aren't counted. */
  browsers: string[];
  /** Index in `policies`: the newest version, for reports from an older one. */
  policy: number;
  /** The first and last report's dates, when the collector kept them. */
  first?: number;
  last?: number;
  /** Identifies the problem from one reading to the next (for `trusted`). */
  key: string;
  /**
   * An address no catalogue tool uses, outside the site's own domain: a forgotten tool, or injected code. Its line
   * is left out unless the visitor said they know it (`trusted`); then `fix` is set and covered by the lines.
   */
  unknown?: true;
  /** Not the site's doing: set apart, with no line. */
  noise?: NoiseKind;
  /** How urgent it is, and why (problems of the site only). */
  risk?: Risk;
}

/**
 * Why a problem comes before another: report counts say how busy a page is, not how much is at stake. An address no
 * tool uses may be injected code; a page where visitors pay or sign in is where a skimmer goes, and where something
 * broken costs most; code blocked for visitors breaks a feature, a style only a look.
 */
export type RiskReason =
  | { kind: 'unknown' }
  | { kind: 'sensitive'; page: string }
  | { kind: 'enforced' }
  | { kind: 'reported' }
  | { kind: 'code' }
  | { kind: 'look' }
  | { kind: 'new'; since: number }
  | { kind: 'stopped'; since: number };

export interface Risk {
  level: 'high' | 'medium' | 'low';
  /** Higher first; ties go to the problem with more reports. */
  score: number;
  reasons: RiskReason[];
}

/**
 * Why a problem isn't the site's doing:
 * - `extension`: a browser extension (the address, or the code that asked for it);
 * - `software`: software on the visitor's device or network that adds code to every page (antivirus, adware, company
 *   proxies);
 * - `translation`: a translator adding its own styles and scripts, or the page shown through one;
 * - `in-app`: seen only in apps' built-in browsers (Instagram, Facebook, TikTok…), which add their own code;
 * - `bot`: seen only from crawlers and automated browsers;
 * - `copy`: the page shown somewhere else (a search engine's cache, an archive, a saved file);
 * - `browser`: the browser's own pages and internal addresses.
 */
export type NoiseKind = 'extension' | 'software' | 'translation' | 'in-app' | 'bot' | 'copy' | 'browser';
export const NOISE_KINDS: readonly NoiseKind[] = ['extension', 'software', 'translation', 'in-app', 'bot', 'copy', 'browser'];

export interface ReportPolicy {
  text: string;
  reportOnly: boolean;
  /** No report said whether it was enforced (Safari's older format): taken as enforced. */
  guessed: boolean;
  reports: number;
  /** The policy with every line its reports need, when some do. */
  fixed?: FixedPolicy;
  /** Its last report's date, when the collector kept dates. */
  last?: number;
  /**
   * Index of the newer policy that replaced it (same disposition, every report of which came after this one's last):
   * its reports are read against that one, and it gets no lines of its own.
   */
  replacedBy?: number;
}

/** A Trusted Types policy name the `trusted-types` rule doesn't list. */
export interface RefusedPolicyName {
  name: string;
  reports: number;
  policy: number;
}

export interface ExplainedReports {
  /** Reports read. */
  total: number;
  /** Lines that held something else. */
  skipped: number;
  /** Problems, riskiest first (`risk`), then most reports first. */
  groups: ReportGroup[];
  /** Set apart: not caused by the site, by cause in the order of `NOISE_KINDS`, then most reports first. */
  noise: ReportGroup[];
  /** Set apart: reported under an older policy, and the newest one allows it. */
  allowed: ReportGroup[];
  /** The first and last dates of all the reports read (before `since`), when the collector kept dates. */
  period?: { from: number; to: number };
  /** With `since`: reports left out for being older, and for having no date. */
  before: number;
  undated: number;
  /** One line per rule to change, per policy. */
  lines: PolicyLine[];
  policies: ReportPolicy[];
  names: RefusedPolicyName[];
  /** The site's origin, when every report comes from the same one. */
  origin?: string;
}

const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension(?::|$)/i;
const INLINE = new Set(['inline', '', 'self']);

// What browsers report about themselves, and the hosts of software that adds code to every page: from Sentry's list
// of CSP noise ("sourced from personal experience as well as reputable blogs from Twitter and Dropbox",
// `DEFAULT_DISALLOWED_SOURCES` in getsentry/sentry, src/sentry/interfaces/security.py), without the widgets a site can
// use on purpose (amung.us, siteheart.net) and localhost; and Kaspersky's and AdGuard's local injection hosts.
const BROWSER = /^(?:about|chrome|chromeinvokeimmediate|chromenull|mxaddon-pkg|jar|webviewprogressproxy|tmtbff|mbinit|symres|resource)(?::|$)|^data:text\/html,chromewebdata/i;
const SOFTWARE = [
  'kaspersky-labs.com', 'local.adguard.org', 'injections.adguard.com', 'gateway.zscalertwo.net', 'www.passpack.com',
  'metrext.com', 'static.image2play.com', 'tlscdn.com', '73a5b0806e464be8bd4e694c744624f0.com', '020dfefc4ac745dab7594f2f771c1ded.com',
  'superfish.com', 'v.zilionfast.in', 'xls.searchfun.in', 'istatic.datafastguru.info', 'resultshub-a.akamaihd.net', 'pulseadnetwork.com',
  'middlerush-a.akamaihd.net', 'www.websmartcenter.com', 'a.linkluster.com', 'saveyoutime.ru', 'cdncache-a.akamaihd.net', 'x.rafomedia.com',
  'savingsslider-a.akamaihd.net', 'icontent.us', 'amiok.org', 'connectionstrenth.com', 'netanalitics.space', 'printapplink.com',
  'godlinkapp.com', 'devappstor.com', 'hoholikik.club', 'smartlink.cool', 'promfflinkdev.com',
];
/** Chrome's built-in translation fetches its styles and scripts from these. */
const TRANSLATION = ['translate.googleapis.com', 'translate-pa.googleapis.com'];
/** Pages shown somewhere else: a search engine's cache, an archive. */
const COPIES = ['webcache.googleusercontent.com', 'cc.bingj.com', 'web.archive.org', 'archive.ph', 'archive.today', 'archive.is'];
const IN_APP = /\b(?:FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|Bytedance\w*|TikTok|Snapchat|LinkedInApp)\b|\bLine\/|\bPinterest\//;
// "bot/" and the like, so that a phone called CUBOT isn't one.
const BOT = /(?:bot|crawler|spider)[\w-]*\/|\b(?:HeadlessChrome|PhantomJS|Chrome-Lighthouse|Google-InspectionTool|facebookexternalhit)\b/i;

const hostIn = (host: string | undefined, list: readonly string[]) => host !== undefined && list.some((h) => host === h || host.endsWith(`.${h}`));
const urlHost = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** What a report alone says about its cause: what was blocked, the code that asked for it, the page it came from. */
function noiseOf(r: ViolationReport): NoiseKind | undefined {
  const things = [r.blocked, r.sourceFile ?? ''];
  if (things.some((t) => EXTENSION.test(t))) return 'extension';
  if (things.some((t) => BROWSER.test(t))) return 'browser';
  if (things.some((t) => hostIn(urlHost(t), SOFTWARE))) return 'software';
  const page = urlHost(r.page);
  if (hostIn(urlHost(r.blocked), TRANSLATION) || page?.endsWith('.translate.goog')) return 'translation';
  if (hostIn(page, COPIES) || (r.page !== undefined && /^[a-z][\w+.-]*:/i.test(r.page) && !/^https?:/i.test(r.page))) return 'copy';
  return undefined;
}

/** What every report of a problem says about the browsers that sent it: only apps' browsers, or only bots. */
function agentsOf(reports: ViolationReport[]): NoiseKind | undefined {
  const agents = reports.map((r) => r.userAgent);
  if (agents.some((a) => !a)) return undefined;
  if (agents.every((a) => IN_APP.test(a!))) return 'in-app';
  if (agents.every((a) => BOT.test(a!))) return 'bot';
  return undefined;
}

export interface ReportOptions {
  /** Keys of unknown addresses the visitor knows: their lines go in. */
  trusted?: ReadonlySet<string>;
  /** Only the reports received from then on (milliseconds since 1970). */
  since?: number;
}

/** 'self', when the reports don't say which site they're from. */
const PLACEHOLDER_ORIGIN = 'https://your-site.example';

/** The reports in `input` (text, or reports already read), grouped and explained with the catalogue. */
export function explainReports(input: string | ReadReports, vendors: Vendor[], { trusted = new Set(), since }: ReportOptions = {}): ExplainedReports {
  const read = typeof input === 'string' ? readReports(input) : input;
  const times = read.reports.map((r) => r.time).filter((t) => t !== undefined);
  const period = times.length > 0 ? { from: Math.min(...times), to: Math.max(...times) } : undefined;
  const reports = since === undefined ? read.reports : read.reports.filter((r) => r.time !== undefined && r.time >= since);
  const undated = since === undefined ? 0 : read.reports.filter((r) => r.time === undefined).length;
  const before = read.reports.length - reports.length - undated;
  // The site is where its own pages are: not a translator's or a cache's copy of them.
  const origins = new Set(reports.filter((r) => { const n = noiseOf(r); return n !== 'copy' && n !== 'translation'; }).map((r) => originOf(r.page)).filter((o) => o !== undefined));
  const origin = origins.size === 1 ? [...origins][0]! : undefined;

  const policies = policiesOf(reports);
  const policyIndex = (r: ViolationReport) => policies.findIndex((p) => p.text === (r.policy ?? '') && p.reportOnly === (r.disposition === 'report'));

  interface Pending {
    key: string;
    v: Violation;
    reports: ViolationReport[];
    policy: number;
    /** Reports under the newest policy itself, not an older one read against it. */
    current: number;
    noise?: NoiseKind;
  }
  const pending = new Map<string, Pending>();
  const names = new Map<string, RefusedPolicyName>();
  for (const sent of reports) {
    const own = policyIndex(sent);
    const policy = policies[own]!.replacedBy ?? own;
    // An older policy's report, as the newest one would have seen it.
    const r = policy === own ? sent : { ...sent, policy: policies[policy]!.text };
    if (r.blocked === 'trusted-types-policy') {
      const name = r.sample?.trim() || '?';
      const key = `${policy}|${name}`;
      const known = names.get(key);
      if (known) known.reports++;
      else names.set(key, { name, reports: 1, policy });
      continue;
    }
    const v = violationOf(r);
    const noise = noiseOf(r);
    const target = v.kind === 'url' ? (originOf(v.url) ?? v.url) : `${v.kind}|${v.sink ?? ''}`;
    // By the policy's text, not its place in the list, which changes with `since`.
    const key = `${r.disposition}|${r.policy ?? ''}|${v.effective ?? v.directive}|${target}|${noise ?? ''}`;
    const group = pending.get(key) ?? pending.set(key, { key, v, reports: [], policy, current: 0, ...(noise ? { noise } : {}) }).get(key)!;
    group.reports.push(r);
    if (policy === own) group.current++;
  }

  // Lines only from what the site itself needs: what an extension asked for never goes in, nor an unknown address
  // the visitor hasn't vouched for, nor what the newest policy already allows.
  const options = origin ? { origin } : {};
  // A problem only apps' browsers or bots reported isn't the site's either.
  for (const p of pending.values()) p.noise ??= agentsOf(p.reports);
  const site = [...pending.values()].filter((p) => !p.noise);
  const elsewhere = [...pending.values()].filter((p) => p.noise);
  const siteItems = explainItems(site.map((p) => ({ v: p.v, others: [] })), vendors).map((item, i) => {
    const p = site[i]!;
    if (p.current === 0 && allowedBy(item, origin ?? PLACEHOLDER_ORIGIN)) return { item: { ...item, fix: undefined, weaker: undefined }, unknown: false, allowed: true };
    const unknown = isUnknown(item, p.reports, origin);
    return { item: unknown && !trusted.has(p.key) ? { ...item, fix: undefined } : item, unknown, allowed: false };
  });
  const explained = linesOf(siteItems.map((s) => s.item), options);
  const items = [...siteItems.map((s) => s.item), ...explainItems(elsewhere.map((p) => ({ v: p.v, others: [] })), vendors)];
  const all = [...site, ...elsewhere].map((p, i) => {
    const item = items[i]!;
    // Nothing to add to the policy; an extension's own code asking for an address is the extension's.
    const shown: ExplainedViolation =
      p.noise === 'extension' && item.case !== 'extension'
        ? { ...item, case: 'extension', host: hostOf(p.reports[0]!.sourceFile ?? p.v.url ?? ''), tools: [], fix: undefined, weaker: undefined }
        : p.noise
          ? { ...item, fix: undefined, weaker: undefined }
          : item;
    const dates = p.reports.map((r) => r.time).filter((t) => t !== undefined);
    const group: ReportGroup = {
      explained: shown,
      reports: p.reports.length,
      pages: ranked(p.reports.map((r) => pageOf(r.page, origin))).map(([page, reports]) => ({ page, reports })),
      browsers: ranked(p.reports.map((r) => browserOf(r.userAgent))).map(([b]) => b),
      policy: p.policy,
      ...(dates.length > 0 ? { first: Math.min(...dates), last: Math.max(...dates) } : {}),
      key: p.key,
      ...(siteItems[i]?.unknown ? { unknown: true as const } : {}),
      ...(p.noise ? { noise: p.noise } : {}),
    };
    return { group, allowed: siteItems[i]?.allowed === true };
  });
  for (const fixed of explained.fixed) {
    const policy = policies.find((p) => p.replacedBy === undefined && p.text === fixed.before && p.reportOnly === fixed.reportOnly);
    if (policy) policy.fixed = fixed;
  }
  const byReports = (a: ReportGroup, b: ReportGroup) => b.reports - a.reports;
  const groups = all.filter((g) => !g.group.noise && !g.allowed).map((g) => g.group);
  for (const g of groups) g.risk = riskOf(g, trusted, period);
  return {
    total: reports.length,
    skipped: read.skipped,
    groups: groups.sort((a, b) => b.risk!.score - a.risk!.score || byReports(a, b)),
    noise: all
      .filter((g) => g.group.noise)
      .map((g) => g.group)
      .sort((a, b) => NOISE_KINDS.indexOf(a.noise!) - NOISE_KINDS.indexOf(b.noise!) || byReports(a, b)),
    allowed: all.filter((g) => g.allowed).map((g) => g.group).sort(byReports),
    lines: explained.lines,
    policies,
    names: [...names.values()].sort((a, b) => b.reports - a.reports),
    ...(origin ? { origin } : {}),
    ...(period ? { period } : {}),
    before,
    undated,
  };
}

/**
 * Words in a page's address that say visitors pay, sign in or give personal details there (English, French, German,
 * Spanish, Italian). Read word by word, so that `/display` isn't `pay`.
 */
const SENSITIVE = new Set(
  (
    'checkout cart basket payment payments pay billing order orders purchase login signin logon account myaccount register signup password ' +
    'auth oauth sso wallet panier commande paiement connexion compte inscription caisse kasse warenkorb bezahlen anmelden konto ' +
    'carrito pago cuenta carrello pagamento'
  ).split(' '),
);
const SENSITIVE_PAIRS = ['sign in', 'log in', 'sign up'];

/** Is `page` one where visitors pay, sign in or give personal details? */
export function isSensitive(page: string): boolean {
  let path = page;
  try {
    path = new URL(page, PLACEHOLDER_ORIGIN).pathname;
  } catch {
    // As written.
  }
  const words = path.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  return words.some((w) => SENSITIVE.has(w)) || words.some((w, i) => SENSITIVE_PAIRS.includes(`${w} ${words[i + 1]}`));
}

const DAY = 24 * 60 * 60 * 1000;
/** What runs code or sends data, against what only changes the look. */
const CODE_TYPES = new Set(['script', 'worker', 'connect', 'frame', 'form', 'object', 'base', 'eval', 'inline-script', 'inline-handler']);
const LOOK_TYPES = new Set(['style', 'img', 'font', 'media', 'inline-style', 'style-attr']);

/** How urgent a problem of the site is: what it is, where, whether visitors are affected, and when. */
function riskOf(g: ReportGroup, trusted: ReadonlySet<string>, period: { from: number; to: number } | undefined): Risk {
  const e = g.explained;
  const reasons: RiskReason[] = [];
  let score = 0;
  const add = (reason: RiskReason, points: number) => {
    reasons.push(reason);
    score += points;
  };
  if (g.unknown && !trusted.has(g.key)) add({ kind: 'unknown' }, 100);
  // Mostly on such pages: something blocked everywhere is about the whole site, not the checkout.
  const sensitive = g.pages.filter((p) => isSensitive(p.page));
  if (sensitive.length > 0 && sensitive.length * 2 >= g.pages.length) add({ kind: 'sensitive', page: sensitive[0]!.page }, 40);
  add({ kind: e.violation.reportOnly ? 'reported' : 'enforced' }, e.violation.reportOnly ? 0 : 20);
  const type = e.case === 'trusted-types' || e.case === 'handler' ? 'inline-handler' : e.case === 'eval' ? 'eval' : e.violation.type;
  if (CODE_TYPES.has(type)) add({ kind: 'code' }, 15);
  else if (LOOK_TYPES.has(type)) add({ kind: 'look' }, -5);
  // Over a few days: new well after the reports start, or gone well before they end.
  if (period && g.first !== undefined && g.last !== undefined && period.to - period.from >= 3 * DAY) {
    const span = period.to - period.from;
    if (g.first - period.from >= Math.max(DAY, 0.4 * span)) add({ kind: 'new', since: g.first }, 15);
    else if (period.to - g.last >= Math.max(DAY, 0.25 * span)) add({ kind: 'stopped', since: g.last }, -20);
  }
  // Seen on more pages: more likely everywhere. A few points, never more than a reason.
  score += Math.min(g.pages.length, 10);
  return { level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', score, reasons };
}

/**
 * The policies the reports carry, in order of appearance. With dates, a policy every report of which came before
 * the first report of a newer one (same disposition) was replaced by it: the newest of those it can be.
 */
function policiesOf(reports: ViolationReport[]): ReportPolicy[] {
  const policies: (ReportPolicy & { first?: number })[] = [];
  for (const r of reports) {
    const text = r.policy ?? '';
    const reportOnly = r.disposition === 'report';
    let p = policies.find((q) => q.text === text && q.reportOnly === reportOnly);
    if (!p) policies.push((p = { text, reportOnly, guessed: r.guessed === true, reports: 0 }));
    p.reports++;
    if (r.time !== undefined) {
      p.first = Math.min(p.first ?? r.time, r.time);
      p.last = Math.max(p.last ?? r.time, r.time);
    }
  }
  // Only the newest policy of each disposition takes over older ones: a policy still in use on some pages, or
  // overlapping in time, stays a policy of its own.
  for (const reportOnly of [false, true]) {
    const same = policies.filter((p) => p.reportOnly === reportOnly && p.text !== '' && p.last !== undefined);
    const newest = same.reduce<(typeof same)[number] | undefined>((a, p) => (!a || p.last! > a.last! ? p : a), undefined);
    if (!newest) continue;
    for (const p of same) if (p !== newest && p.last! < newest.first!) p.replacedBy = policies.indexOf(newest);
  }
  return policies.map(({ first: _, ...p }) => p);
}

/** The newest policy (the one the item now carries) allows what an older one blocked: an address, or eval. */
function allowedBy(item: ExplainedViolation, origin: string): boolean {
  const v = item.violation;
  const source = item.fix?.add[0] ?? item.weaker?.add[0];
  if (!v.value || !source || (item.case !== 'address' && item.case !== 'eval')) return false;
  const parsed = { input: v.value, policies: [parseSinglePolicy(v.value)], issues: [] };
  const type = item.case === 'eval' ? 'eval' : v.type;
  return checkRequirement(parsed, { type, source, ...(v.url && item.case === 'address' ? { probe: v.url } : {}), reason: '' }, origin).verdict !== 'blocked';
}

/**
 * An address no catalogue tool uses, on a host outside the domain of the pages that reported it. Local schemes
 * (`data:`, `blob:`) aren't addresses anyone can serve from elsewhere: they keep their own warning.
 */
function isUnknown(item: ExplainedViolation, reports: ViolationReport[], origin: string | undefined): boolean {
  if (item.case !== 'address' || item.tools.length > 0 || !item.violation.url) return false;
  let host: string;
  try {
    const u = new URL(item.violation.url);
    if (!/^(?:https?|wss?):$/.test(u.protocol)) return false;
    host = u.hostname;
  } catch {
    return false;
  }
  const sites = new Set([origin, ...reports.map((r) => originOf(r.page))].filter((o) => o !== undefined).map((o) => siteOf(new URL(o).hostname)));
  return !sites.has(siteOf(host));
}

/** Second-level suffixes a registrable domain sits under (`shop.co.uk`): close enough without the public suffix list. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or', 'go', 'gob', 'gouv']);

/** The domain a host belongs to (`cdn.shop.example.com` → `example.com`), so a site's own subdomains count as its own. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2 || /^[\d.]+$/.test(host) || host.includes(':')) return labels.join('.');
  const n = labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/** A report as a console message would have told it: what was blocked, under which rule, of which policy. */
function violationOf(r: ViolationReport): Violation {
  const effective = r.directive;
  const policy = r.policy ? parseSinglePolicy(r.policy) : undefined;
  const directive = (policy && resolve(policy, effective).governing?.name) || effective;
  const blocked = r.blocked.toLowerCase();
  const kind = kindOf(blocked, effective);
  const base = {
    text: `${effective} ${r.blocked}`,
    directive,
    ...(effective !== directive ? { effective } : {}),
    ...(r.policy ? { value: r.policy } : {}),
    reportOnly: r.disposition === 'report',
    count: 1,
  };
  if (kind === 'trusted-types') {
    // The sample starts with the sink: "HTMLScriptElement src|https://…", "Element innerHTML|<img…".
    const sinkMatch = /^([A-Z][\w$]*) ([\w$]+)\|/.exec(r.sample ?? '');
    const sink = sinkMatch ? `${sinkMatch[1]}.${sinkMatch[2]}` : undefined;
    const trustedType = sink ? trustedTypeOf(sink) : undefined;
    return { ...base, kind, type: 'script', ...(sink ? { sink } : {}), ...(trustedType ? { trustedType } : {}) };
  }
  if (kind === 'url') {
    const url = blocked === 'data' || blocked === 'blob' ? `${blocked}:` : r.blocked;
    return { ...base, kind, url, type: DIRECTIVE_TYPE[effective] ?? DIRECTIVE_TYPE[directive] ?? (effective === 'child-src' ? 'frame' : 'script') };
  }
  return { ...base, kind, type: kind };
}

function kindOf(blocked: string, directive: string): BlockedKind {
  if (blocked === 'eval' || blocked === 'wasm-eval') return 'eval';
  if (blocked.startsWith('trusted-types')) return 'trusted-types';
  if (INLINE.has(blocked)) {
    if (directive === 'script-src-attr') return 'inline-handler';
    if (directive === 'style-src-attr') return 'style-attr';
    return directive.startsWith('style') ? 'inline-style' : 'inline-script';
  }
  return 'url';
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** A page's address without its query string or `#` part (they can hold personal data), and without the site's origin. */
function pageOf(url: string | undefined, origin: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.origin === origin ? u.pathname : `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** The distinct values, most frequent first, without the missing ones. */
function ranked(values: (string | undefined)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
