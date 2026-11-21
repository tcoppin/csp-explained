import type { Translate } from '../../i18n';
import { NOISE_KINDS, type ExplainedReports, type ReportGroup } from '../violation-reports';

/**
 * The reports reader's results as data, for a spreadsheet, a tracker or a SIEM: one row (CSV) or record (JSON) per
 * problem, riskiest first, then what the newest policy allows, then what was set apart. Made from the results, never
 * from the reports themselves. The JSON keys are stable English names; the CSV headers are in the reader's language,
 * for people opening it in a spreadsheet.
 */

export interface ResultsMeta {
  /** What was read: the example, a file's name, or pasted reports. */
  source: string;
  date: Date;
  /** Only the reports since then. */
  since?: number;
  pages: boolean;
  samples: boolean;
  policies: boolean;
  /** Domains the visitor counted as the site's own. */
  own?: readonly string[];
}

type Status = 'high' | 'medium' | 'low' | 'allowed' | 'set-apart';

interface Row {
  status: Status;
  group: ReportGroup;
}

/** Every problem in the order the page shows them. */
function rowsOf(r: ExplainedReports): Row[] {
  return [
    ...r.groups.map((group) => ({ status: (group.risk?.level ?? 'low') as Status, group })),
    ...r.allowed.map((group) => ({ status: 'allowed' as const, group })),
    ...[...r.noise].sort((a, b) => NOISE_KINDS.indexOf(a.noise!) - NOISE_KINDS.indexOf(b.noise!)).map((group) => ({ status: 'set-apart' as const, group })),
  ];
}

/** A problem named in a sentence ("A script from static.hotjar.com"), without its markup. */
export function whatText(t: Translate, g: ReportGroup): string {
  const e = g.explained;
  const v = e.violation;
  const key =
    e.case === 'extension' || e.case === 'ancestors' ? e.case : e.case === 'trusted-types' ? `trusted.${v.trustedType ?? 'unknown'}` : v.kind === 'url' ? v.type : v.kind;
  return t(`violations.what.${key}`, { host: e.host ?? '', count: e.count }).replace(/`/g, '');
}

const iso = (time: number | undefined) => (time === undefined ? undefined : new Date(time).toISOString());

/** The results as JSON. */
export function resultsJson(r: ExplainedReports, t: Translate, meta: ResultsMeta): string {
  const problem = ({ status, group: g }: Row, i: number) => {
    const e = g.explained;
    const v = e.violation;
    return {
      rank: i + 1,
      status,
      ...(g.noise ? { cause: g.noise } : {}),
      what: whatText(t, g),
      blocked: v.url ?? v.kind,
      ...(e.host ? { host: e.host } : {}),
      directive: v.directive ?? null,
      ...(v.effective ? { effectiveDirective: v.effective } : {}),
      reportOnly: v.reportOnly,
      reports: g.reports,
      pageCount: g.pages.length,
      ...(meta.pages ? { pages: g.pages } : {}),
      browsers: g.browsers,
      ...(g.first !== undefined ? { first: iso(g.first), last: iso(g.last) } : {}),
      ...(g.unknown ? { unknown: true } : {}),
      ...(g.own ? { ownDomain: g.site } : {}),
      ...(g.risk ? { reasons: g.risk.reasons.map((reason) => ({ ...reason, ...('since' in reason ? { since: iso(reason.since) } : {}) })) } : {}),
      tools: [...new Set(e.tools.map((u) => u.vendor.id))],
      ...(e.fix ? { fix: { directive: e.fix.directive, add: e.fix.add, inLines: e.fix.inLines } } : {}),
      ...(e.weaker && !e.weaker.ignored ? { weaker: { risk: e.weaker.risk, directive: e.weaker.directive, add: e.weaker.add } } : {}),
      ...(meta.samples && g.samples ? { samples: g.samples } : {}),
      ...(meta.samples && g.sources ? { sources: g.sources } : {}),
      ...(g.sampleRule ? { addReportSampleTo: g.sampleRule } : {}),
    };
  };
  return `${JSON.stringify(
    {
      generator: 'CSP Explained',
      exported: meta.date.toISOString(),
      source: meta.source,
      ...(r.origin ? { site: r.origin } : {}),
      ...(r.period ? { received: { from: iso(r.period.from), to: iso(r.period.to) } } : {}),
      ...(meta.since !== undefined ? { since: iso(meta.since) } : {}),
      reports: { read: r.total, leftOutAsOlder: r.before, leftOutUndated: r.undated, notReports: r.skipped },
      ...(meta.own && meta.own.length > 0 ? { ownDomains: meta.own } : {}),
      readiness: r.readiness.map((ready) => ({ ...ready, policy: ready.policy + 1 })),
      problems: rowsOf(r).map(problem),
      lines: r.lines.map((l) => ({
        policy: r.policies.findIndex((p) => p.text === l.policy && p.reportOnly === l.reportOnly) + 1,
        directive: l.directive,
        created: l.created,
        reportOnly: l.reportOnly,
        line: l.line,
      })),
      ...(meta.policies
        ? { policies: r.policies.map((p, i) => ({ n: i + 1, reportOnly: p.reportOnly, reports: p.reports, ...(p.replacedBy !== undefined ? { replacedBy: p.replacedBy + 1 } : {}), text: p.text })) }
        : {}),
    },
    null,
    2,
  )}\n`;
}

/** The results as CSV: one row per problem, headers in the reader's language. */
export function resultsCsv(r: ExplainedReports, t: Translate, meta: ResultsMeta): string {
  const h = (key: string) => t(`reportsReader.save.csv.${key}`);
  const headers = [h('rank'), h('status'), h('what'), h('blocked'), h('directive'), h('reports'), h('pageCount'), ...(meta.pages ? [h('pages')] : []), h('browsers'), h('first'), h('last'), h('why'), h('tools'), h('fix'), ...(meta.samples ? [h('samples'), h('sources')] : [])];
  const status = ({ status, group }: Row) =>
    status === 'allowed' ? t('reportsReader.fixed') : status === 'set-apart' ? `${t('reportsReader.save.csv.setApart')}: ${t(`reportsReader.noise.${group.noise}.name`)}` : t(`reportsReader.risk.level.${status}`);
  const rows = rowsOf(r).map((row, i) => {
    const g = row.group;
    const e = g.explained;
    const v = e.violation;
    return [
      String(i + 1),
      status(row),
      whatText(t, g),
      v.url ?? v.kind,
      v.directive ?? '',
      String(g.reports),
      String(g.pages.length),
      ...(meta.pages ? [g.pages.map((p) => `${p.page} (${p.reports})`).join('; ')] : []),
      g.browsers.join('; '),
      iso(g.first) ?? '',
      iso(g.last) ?? '',
      (g.risk?.reasons ?? []).map((reason) => reason.kind).join('; '),
      [...new Set(e.tools.map((u) => u.vendor.name))].join('; '),
      e.fix ? `${e.fix.directive} ${e.fix.add.join(' ')}` : '',
      ...(meta.samples ? [(g.samples ?? []).map((s) => s.text).join('; '), (g.sources ?? []).map((s) => s.file).join('; ')] : []),
    ];
  });
  return `${[headers, ...rows].map((cells) => cells.map(cell).join(',')).join('\r\n')}\r\n`;
}

/**
 * One CSV cell: quoted when it holds a comma, a quote or a line break. A cell a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, a tab or a carriage return first) starts with an apostrophe: what the reports carry comes from
 * visitors' browsers, and must never run as a formula when the file is opened.
 */
export function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
