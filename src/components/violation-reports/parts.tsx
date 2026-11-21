import { useT } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import type { ReportGroup, Readiness } from '../../lib/violation-reports';

/** Pages listed under a problem before "and N more". */
const PAGES_SHOWN = 8;

// What the results and their saved copy both say: the summary, the verdict on enforcing, why a problem ranks where
// it is, and the days.

/**
 * "From your site: 2 to check first, 3 to look at next…", each count highlighted like the rows' level, so the
 * summary is also the key to their colours.
 */
export function Summary({ levels }: { levels: (readonly [string, number])[] }) {
  const t = useT();
  const words = levels.map(([level, count]) => t(`reportsReader.levels.${level}`, { count }));
  let n = 0;
  const parts = new Intl.ListFormat(t.locale, { type: 'conjunction' }).formatToParts(words).map((part, i) => {
    if (part.type !== 'element') return part.value;
    const level = levels[n++]![0];
    return (
      <span key={i} class={`report-level ${level}`}>
        {part.value}
      </span>
    );
  });
  return (
    <>
      {t('reportsReader.summaryLead')} {parts}.
    </>
  );
}

/**
 * "Can you enforce it?", for a report-only policy: not yet (what it would block, how much the lines settle), too soon
 * to say, or ready, with what to do next. The verdict is said in words; its colour only repeats it.
 */
export function Enforce({ ready, n }: { ready: Readiness; n: number | undefined }) {
  const t = useT();
  const days =
    ready.days === undefined ? '' : ready.days < 1 ? t('reportsReader.enforce.lessThanDay') : t('reportsReader.enforce.days', { count: Math.round(ready.days) });
  const rest = ready.blocking - ready.inLines;
  return (
    <section class={`report-enforce ${ready.verdict}`} aria-labelledby={`report-enforce-${ready.policy}`}>
      <h3 id={`report-enforce-${ready.policy}`}>{n === undefined ? t('reportsReader.enforce.title') : t('reportsReader.enforce.titleN', { n })}</h3>
      {ready.verdict === 'not-yet' && (
        <>
          <p>
            <Rich msg="reportsReader.enforce.notYet" vars={{ count: ready.blocking }} />
            {ready.inLines > 0 && (
              <> {ready.inLines === ready.blocking ? t('reportsReader.enforce.allInLines') : t('reportsReader.enforce.inLines', { count: ready.inLines })}</>
            )}
            {rest > 0 && <> {t('reportsReader.enforce.needsWork', { count: rest })}</>}
          </p>
          <p>{t('reportsReader.enforce.notYetNext')}</p>
        </>
      )}
      {ready.verdict === 'too-soon' && (
        <p>
          <Rich msg="reportsReader.enforce.tooSoon" />{' '}
          {ready.days === undefined ? t('reportsReader.enforce.tooSoonUndated') : t('reportsReader.enforce.tooSoonDays', { days })}
        </p>
      )}
      {ready.verdict === 'ready' && (
        <>
          <p>
            <Rich msg="reportsReader.enforce.ready" vars={{ days }} />
            {ready.noise > 0 && <> {t('reportsReader.enforce.readyNoise', { count: ready.noise })}</>}
          </p>
          <ol>
            {(['header', 'unseen', 'next'] as const).map((step) => (
              <li key={step}>
                <Rich msg={`reportsReader.enforce.readySteps.${step}`} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * Why a problem is ranked where it is, when something sets it apart: an unknown address, a checkout or sign-in page,
 * new or gone. Its level is in its row; "blocked" and "a script" are in its status and name already.
 */
const TELLING = new Set(['unknown', 'sensitive', 'new', 'stopped']);
export function RiskLine({ g }: { g: ReportGroup }) {
  const t = useT();
  const reasons = (g.risk?.reasons ?? [])
    .filter((r) => TELLING.has(r.kind))
    .map((r) =>
      r.kind === 'sensitive'
        ? t('reportsReader.risk.sensitive', { page: r.page })
        : r.kind === 'new' || r.kind === 'stopped'
          ? t(`reportsReader.risk.${r.kind}`, { date: dayName(t.locale, r.since) })
          : t(`reportsReader.risk.${r.kind}`),
    );
  if (reasons.length === 0) return null;
  // The level is in the row already.
  const list = new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(reasons);
  return <p class="report-risk">{t('reportsReader.risk.why', { reasons: list })}</p>;
}

/** A day as people read it ("Nov 13, 2026"), in the visitor's time zone. */
export const dayName = (locale: string, time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(time);
/** A day as a date field takes it (`2026-11-13`), in the visitor's time zone. */
export function dayValue(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const sameDay = (a: number, b: number) => dayValue(a) === dayValue(b);

/** How many reports a problem stands for, from which pages and browsers. */
export function Stats({ g, policies, paper }: { g: ReportGroup; policies: number; paper?: { pages: boolean } }) {
  const t = useT();
  const list = (items: string[]) => new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(items);
  const shown = g.pages.slice(0, PAGES_SHOWN);
  return (
    <div class="report-stats">
      <p>
        {t('reportsReader.stats.reports', { count: g.reports })}
        {g.pages.length === 1 && (
          <>
            {' '}
            <Rich msg="reportsReader.stats.onePage" vars={{ page: g.pages[0]!.page }} />
          </>
        )}
        {g.pages.length > 1 && <> {t('reportsReader.stats.pages', { count: g.pages.length })}</>}
        {g.browsers.length > 0 && <> {t('reportsReader.stats.browsers', { browsers: list(g.browsers) })}</>}
        {policies > 0 && <> {t('reportsReader.stats.policy', { n: g.policy + 1 })}</>}
        {t('reportsReader.stats.end')}
        {g.first !== undefined && g.last !== undefined && (
          <>
            {' '}
            {sameDay(g.first, g.last)
              ? t('reportsReader.stats.seenOnce', { date: dayName(t.locale, g.first) })
              : t('reportsReader.stats.seen', { first: dayName(t.locale, g.first), last: dayName(t.locale, g.last) })}
          </>
        )}
      </p>
      {paper
        ? paper.pages &&
          g.pages.length > 1 && (
            <p class="doc-pages">
              {t('reportsReader.save.document.pages', {
                pages: list([
                  ...shown.map((p) => t('reportsReader.stats.pageItem', { page: p.page, count: p.reports })),
                  ...(g.pages.length > shown.length ? [t('reportsReader.stats.more', { count: g.pages.length - shown.length })] : []),
                ]),
              })}
            </p>
          )
        : g.pages.length > 1 && (
        <details class="report-pages">
          <summary>{t('reportsReader.stats.showPages', { count: g.pages.length })}</summary>
          <ul>
            {shown.map((p) => (
              <li key={p.page}>
                <code>{p.page}</code> {t('reportsReader.stats.pageCount', { count: p.reports })}
              </li>
            ))}
            {g.pages.length > shown.length && <li>{t('reportsReader.stats.more', { count: g.pages.length - shown.length })}</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
