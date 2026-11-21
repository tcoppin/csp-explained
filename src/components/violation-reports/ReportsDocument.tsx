import { SITE_URL } from '../../config';
import { localePath, type Translate } from '../../i18n';
import { NOISE_KINDS, type ExplainedReports, type ReportGroup, type ReportPolicy } from '../../lib/violation-reports';
import { encodeCompareState } from '../policy/compare-state';
import { ViolationItem, ViolationWhat } from '../policy/ViolationList';
import { I18n } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import { dayName, Enforce, Quotes, RiskLine, Stats, Summary } from './parts';

/** What a saved copy of the results carries besides the problems and the lines. */
export interface SaveOptions {
  /** The pages each problem happened on (addresses without their query strings). */
  pages: boolean;
  /** What the reports quoted of the code, and the scripts that asked for it: clues, but they can hold data. */
  samples: boolean;
  /** The policies the reports carried, in full. */
  policies: boolean;
}

export const DEFAULT_SAVE: SaveOptions = { pages: true, samples: false, policies: false };

export interface ReportsDocumentProps {
  t: Translate;
  r: ExplainedReports;
  options: SaveOptions;
  /** What was read: the example, a file's name, or pasted reports. */
  source: string;
  /** Only the reports since then, when the visitor picked a day. */
  since?: number;
  /** Unknown addresses the visitor said they know. */
  trusted: ReadonlySet<string>;
  /** Domains the visitor said are theirs. */
  own?: ReadonlySet<string>;
  date: Date;
}

const LEVELS = ['high', 'medium', 'low'] as const;

export const reportsDocumentTitle = (t: Translate) => t('reportsReader.save.document.title');

/**
 * The results as a document for paper, a file or a ticket: what the page shows, unfolded and without anything to fill
 * in. Built from the same pieces as the page, so the two never say different things. Never the reports themselves.
 */
export function ReportsDocument({ t, r, options, source, since, trusted, own = new Set(), date }: ReportsDocumentProps) {
  const list = (items: string[]) => new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(items);
  const several = r.policies.filter((p) => p.replacedBy === undefined).length > 1;
  const levels = [
    ...LEVELS.map((level) => [level, r.groups.filter((g) => g.risk?.level === level).length] as const),
    ['fixed', r.allowed.length] as const,
  ].filter(([, n]) => n > 0);
  const noiseReports = r.noise.reduce((n, g) => n + g.reports, 0);
  const vouched = r.groups.filter((g) => g.unknown && trusted.has(g.key)).length;
  const changedOn = (g: ReportGroup) => {
    const from = r.policies[g.policy]?.first;
    return from === undefined ? '' : dayName(t.locale, from);
  };
  const problem = (g: ReportGroup, i: number, fixed: boolean) => (
    <li key={g.key} class={`doc-problem ${fixed ? 'fixed' : (g.risk?.level ?? 'low')}`}>
      <h3>
        <span class="doc-level">{fixed ? t('reportsReader.fixed') : t(`reportsReader.risk.level.${g.risk?.level ?? 'low'}`)}</span>
        {t('reportsReader.bar.sep')}
        <ViolationWhat e={g.explained} />
      </h3>
      <ViolationItem
        bare
        paper
        {...(fixed ? { until: changedOn(g) } : {})}
        e={g.explained}
        index={i}
        source="reports"
        unknown={g.unknown}
        after={
          g.unknown &&
          !trusted.has(g.key) && (
            <p class="doc-note">
              <Rich msg="reportsReader.unknown" vars={{ host: g.explained.host ?? '' }} />
            </p>
          )
        }
      >
        {fixed ? <p>{t('reportsReader.fixedIntro', { date: changedOn(g) })}</p> : <RiskLine g={g} />}
        <Stats g={g} policies={several ? r.policies.length : 0} paper={{ pages: options.pages }} />
        {options.samples ? <Quotes g={g} paper /> : !g.samples && !g.sources && <Quotes g={g} paper />}
      </ViolationItem>
    </li>
  );

  return (
    // The pieces read their words from the context, as on the page.
    <I18n.Provider value={t}>
      <article class="report-doc reports-doc" lang={t.locale}>
        <header>
          <p class="doc-brand">
            <a href={localePath(t.locale, '/')}>{t('site.name')}</a>
          </p>
          <h1>{reportsDocumentTitle(t)}</h1>
          <dl class="doc-meta">
            {r.origin && <Meta label={t('report.document.site')} value={new URL(r.origin).host} />}
            <Meta label={t('reportsReader.save.document.read')} value={t('reportsReader.save.document.readValue', { source, reports: t('reportsReader.bar.count', { count: r.total + r.before + r.undated }) })} />
            {r.period && <Meta label={t('reportsReader.save.document.received')} value={new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium' }).formatRange(r.period.from, r.period.to)} />}
            <Meta label={t('report.document.date')} value={new Intl.DateTimeFormat(t.locale, { dateStyle: 'long' }).format(date)} />
          </dl>
          {/* What shaped this copy: the day picked, the addresses vouched for. */}
          {(since !== undefined || vouched > 0 || own.size > 0) && (
            <p class="doc-note">
              {[
                since !== undefined && t('reportsReader.since.announce', { count: r.total, date: dayName(t.locale, since) }),
                vouched > 0 && t('reportsReader.save.document.vouched', { count: vouched }),
                own.size > 0 && t('reportsReader.save.document.own', { count: own.size, sites: list([...own].sort()) }),
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
        </header>

        <section>
          <h2>{t('reportsReader.save.document.inShort')}</h2>
          {levels.length > 0 && (
            <p class="doc-lead">
              <Summary levels={levels} />
            </p>
          )}
          {r.noise.length > 0 && <p>{t('reportsReader.noiseLead', { count: noiseReports })}</p>}
          {r.readiness.map((ready) => (
            <Enforce key={ready.policy} ready={ready} n={r.policies.length > 1 ? ready.policy + 1 : undefined} />
          ))}
        </section>

        {r.groups.length + r.allowed.length > 0 && (
          <section>
            <h2>{t('reportsReader.problems', { count: r.groups.length + r.allowed.length })}</h2>
            <ol class="doc-problems">
              {r.groups.map((g, i) => problem(g, i, false))}
              {r.allowed.map((g, i) => problem(g, r.groups.length + i, true))}
            </ol>
          </section>
        )}

        {r.policies.map((p, i) => {
          if (p.replacedBy !== undefined) return null;
          const lines = r.lines.filter((l) => l.policy === p.text && l.reportOnly === p.reportOnly);
          if (lines.length === 0) return null;
          return (
            <section key={i}>
              <h2>{linesTitle(t, p, several ? i + 1 : undefined)}</h2>
              <p>{t('reportsReader.linesIntro')}</p>
              {lines.map((l) => (
                <figure key={`${l.reportOnly}|${l.directive}`} class="doc-code">
                  <figcaption>{t(`violations.lines.${l.created ? 'add' : 'replace'}${l.reportOnly ? 'ReportOnly' : ''}`, { directive: l.directive })}</figcaption>
                  <pre>{l.line}</pre>
                </figure>
              ))}
              {p.fixed && (
                <p>
                  <a href={localePath(t.locale, `/compare#${encodeCompareState({ before: p.fixed.before, after: p.fixed.after, site: '', vendors: {} })}`)}>{t('reportsReader.compare')}</a>
                </p>
              )}
            </section>
          );
        })}

        {r.noise.length > 0 && (
          <section>
            <h2>{t('reportsReader.noiseTitle', { count: noiseReports })}</h2>
            <ul class="doc-set-apart">
              {NOISE_KINDS.map((kind) => {
                const groups = r.noise.filter((g) => g.noise === kind);
                if (groups.length === 0) return null;
                return (
                  <li key={kind}>
                    <strong>{t(`reportsReader.noise.${kind}.name`)}</strong> {t('reportsReader.noiseCount', { count: groups.reduce((n, g) => n + g.reports, 0) })}:{' '}
                    {list(groups.map((g) => (g.explained.case === 'extension' ? g.explained.host ?? '' : whatText(t, g))))}.
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {options.policies && r.policies.length > 0 && (
          <section>
            <h2>{t('reportsReader.policies.title', { count: r.policies.length })}</h2>
            {r.policies.map((p, i) => (
              <figure key={i} class="doc-code">
                <figcaption>{policyCaption(t, p, i)}</figcaption>
                <pre>{p.text || t('reportsReader.policies.missing')}</pre>
              </figure>
            ))}
          </section>
        )}

        <footer>
          <p>
            {t('reportsReader.save.document.footer', { site: t('site.name') })} <a href={new URL(localePath(t.locale, '/reports'), SITE_URL).href}>{t('reportsReader.save.document.link')}</a>
          </p>
        </footer>
      </article>
    </I18n.Provider>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** "What to change in the policy sent from Nov 14, 2026", as on the page. */
export function linesTitle(t: Translate, p: ReportPolicy, n: number | undefined): string {
  if (p.first === undefined) return n ? t('reportsReader.linesFor', { n }) : t('violations.lines.title');
  const date = dayName(t.locale, p.first);
  return n ? t('reportsReader.linesForFrom', { n, date }) : t('reportsReader.linesFrom', { date });
}

function policyCaption(t: Translate, p: ReportPolicy, i: number): string {
  if (p.replacedBy !== undefined) return t('reportsReader.policies.replaced', { n: i + 1, count: p.reports, date: dayName(t.locale, p.last!) });
  return t(`reportsReader.policies.${p.reportOnly ? 'reportOnly' : p.guessed ? 'guessed' : 'enforced'}`, { n: i + 1, count: p.reports });
}

/** A problem named in a sentence ("A script from gc.kis.v2.scr.kaspersky-labs.com"), without its markup. */
function whatText(t: Translate, g: ReportGroup): string {
  const e = g.explained;
  const v = e.violation;
  const key = e.case === 'trusted-types' ? `trusted.${v.trustedType ?? 'unknown'}` : v.kind === 'url' ? v.type : v.kind;
  return t(`violations.what.${key}`, { host: e.host ?? '', count: e.count }).replace(/`/g, '');
}
