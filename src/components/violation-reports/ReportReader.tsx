import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { localePath, translator, type Locale } from '../../i18n';
import type { ContentBundle } from '../../lib/content';
import { readReports } from '../../lib/csp/violation-report';
import { explainReports, NOISE_KINDS, type ExplainedReports, type Readiness, type ReportGroup, type ReportPolicy } from '../../lib/violation-reports';
import { track } from '../../scripts/track';
import { encodeCompareState } from '../policy/compare-state';
import { Lines, ViolationItem, ViolationWhat } from '../policy/ViolationList';
import { I18n, useT } from '../ui/i18n';
import { Rich } from '../ui/Rich';
import { EXAMPLE_REPORTS } from './example';
// Shared view styles first, so the reader's own rules win when they tie
import '../ui/panels.css';
import '../policy/results.css';
import './reports.css';

interface Props {
  content: ContentBundle;
  locale: Locale;
}

/** Larger files are refused: reading them would freeze the page. */
const MAX_BYTES = 50 * 1024 * 1024;
/** Pages listed under a problem before "and N more". */
const PAGES_SHOWN = 8;

type Loaded = { kind: 'none' } | { kind: 'example' } | { kind: 'file'; name: string; size: number };

/**
 * Reads a batch of violation reports (pasted, or opened from a file) on the visitor's device: the problems they
 * stand for, most reports first, what extensions caused set apart, and the lines that allow the rest. Nothing is
 * kept: not in the address, not in the browser's storage.
 */
export default function ReportReader({ content, locale }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  // Pasted text shows in the box; a file's text doesn't (it can be megabytes), only its name.
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'none' });
  const [error, setError] = useState<'tooLarge' | 'unreadable' | undefined>();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const counted = useRef(false);
  // Unknown addresses the visitor says they know: their lines go in. Forgotten with the reports they came from.
  const [trusted, setTrusted] = useState<ReadonlySet<string>>(new Set());
  const [trustNote, setTrustNote] = useState('');
  // "Only the reports since": a day (`YYYY-MM-DD`), from its start in the visitor's time zone.
  const [since, setSince] = useState('');
  const sinceTime = since ? new Date(`${since}T00:00`).getTime() : undefined;

  // Read once; explained again (quickly) when the visitor vouches for an address or picks a day.
  const read = useMemo(() => (text.trim() === '' ? undefined : readReports(text)), [text]);
  const result = useMemo(
    () => (read ? explainReports(read, content.vendors, { trusted, ...(sinceTime !== undefined && Number.isFinite(sinceTime) ? { since: sinceTime } : {}) }) : undefined),
    [read, content.vendors, trusted, sinceTime],
  );

  /** New reports: what was vouched for went with the old ones. */
  function load(next: string, from: Loaded) {
    setText(next);
    setLoaded(from);
    setTrusted(new Set());
    setTrustNote('');
    setSince('');
  }

  function pickSince(day: string) {
    setSince(day);
    setTrustNote('');
  }

  function trust(key: string, host: string, yes: boolean) {
    const next = new Set(trusted);
    if (yes) next.add(key);
    else next.delete(key);
    setTrusted(next);
    setTrustNote(t(`reportsReader.trusted.${yes ? 'added' : 'removed'}`, { host }));
  }

  // Count one batch read per page load, never what it holds; not the example.
  useEffect(() => {
    if (counted.current || !read || read.reports.length === 0 || loaded.kind === 'example') return;
    counted.current = true;
    track('read-reports', { from: loaded.kind === 'file' ? 'file' : 'paste' });
  }, [read, loaded]);

  // "Clear" goes away with what it cleared: the focus goes to the box, if it was lost or is still on the button
  // (which can become "Try an example").
  const cleared = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (cleared.current === undefined) return;
    const pressed = cleared.current;
    cleared.current = undefined;
    const active = document.activeElement;
    if (!active || active === document.body || active === pressed) textArea.current?.focus();
  });

  async function open(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    if (file.size > MAX_BYTES) {
      setError('tooLarge');
      return;
    }
    try {
      load(await file.text(), { kind: 'file', name: file.name, size: file.size });
    } catch {
      setError('unreadable');
    }
  }

  function clear() {
    cleared.current = document.activeElement;
    load('', { kind: 'none' });
    setError(undefined);
  }

  const size = (bytes: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: bytes < 1024 * 1024 ? 'kilobyte' : 'megabyte', maximumFractionDigits: 1 }).format(
      bytes < 1024 * 1024 ? bytes / 1024 : bytes / (1024 * 1024),
    );

  return (
    <I18n.Provider value={t}>
      <div class="report-reader">
        <section
          class={`report-input${dragging ? ' dragging' : ''}`}
          aria-label={t('reportsReader.inputLabel')}
          onDragOver={(e) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer?.files.length) return;
            e.preventDefault();
            setDragging(false);
            void open(e.dataTransfer.files[0]);
          }}
        >
          {loaded.kind === 'file' ? (
            <p class="report-file">
              <Rich msg="reportsReader.fileOpen" vars={{ name: loaded.name, size: size(loaded.size) }} />
            </p>
          ) : (
            <>
              <label for="reports-input" class="report-label">
                {t('reportsReader.pasteLabel')}
              </label>
              <textarea
                id="reports-input"
                ref={textArea}
                class="code"
                rows={8}
                spellcheck={false}
                autocomplete="off"
                aria-describedby="reports-hint"
                value={text}
                onInput={(e) => load(e.currentTarget.value, { kind: 'none' })}
              />
            </>
          )}
          <p id="reports-hint" class="muted format-hint">
            {t('reportsReader.hint')}
          </p>
          <div class="actions">
            <button type="button" class="button" onClick={() => fileInput.current?.click()}>
              {t('reportsReader.openFile')}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".json,.ndjson,.jsonl,.log,.txt,.csv,.tsv,application/json,application/reports+json,application/csp-report,text/plain,text/csv,text/tab-separated-values"
              onChange={(e) => {
                void open(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
            {text.trim() === '' ? (
              <button
                type="button"
                class="button quiet"
                onClick={() => {
                  track('example');
                  setError(undefined);
                  load(EXAMPLE_REPORTS, { kind: 'example' });
                }}
              >
                {t('analyzer.example')}
              </button>
            ) : (
              <button type="button" class="button quiet" onClick={clear}>
                {t('analyzer.clear')}
              </button>
            )}
          </div>
          {error && <p class="issue">{t(`reportsReader.error.${error}`, { max: size(MAX_BYTES) })}</p>}
        </section>

        {/* Always in the page, so the result is announced as it appears; then what the visitor vouched for. */}
        <p class="visually-hidden" role="status">
          {trustNote ||
            (read && result && (read.reports.length === 0 ? t('reportsReader.none') : since ? t('reportsReader.since.announce', { count: result.total, date: dayName(t.locale, sinceTime!) }) : t('reportsReader.announce', { count: result.total })))}
        </p>
        {read && result &&
          (read.reports.length > 0 ? (
            <Results r={result} trusted={trusted} onTrust={trust} since={since} onSince={pickSince} />
          ) : (
            <p class="issue report-none">{t('reportsReader.noneLong')}</p>
          ))}
      </div>
    </I18n.Provider>
  );
}

interface ResultsProps {
  r: ExplainedReports;
  trusted: ReadonlySet<string>;
  onTrust: (key: string, host: string, yes: boolean) => void;
  since: string;
  onSince: (day: string) => void;
}

const LEVELS = ['high', 'medium', 'low'] as const;

/**
 * What the reports come to: a sentence of counts and the verdict on enforcing; then the problems, one row each,
 * riskiest first, opening to their detail (the warnings come before the lines), and last what an older policy blocked
 * that the newest one in the reports allows, since the day it started coming (the reports can't say it is still the
 * one the site sends); then the lines that allow them; and what the site didn't cause, folded at
 * the end.
 */
function Results({ r, trusted, onTrust, since, onSince }: ResultsProps) {
  const t = useT();
  // Older versions get no lines of their own: their reports were read against the newest.
  const several = r.policies.filter((p) => p.replacedBy === undefined).length > 1;
  const noiseReports = r.noise.reduce((n, g) => n + g.reports, 0);
  const stats = (g: ReportGroup) => <Stats g={g} policies={several ? r.policies.length : 0} />;
  const list = (items: string[]) => new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(items);
  const levels = [
    ...LEVELS.map((level) => [level, r.groups.filter((g) => g.risk?.level === level).length] as const),
    ['fixed', r.allowed.length] as const,
  ].filter(([, n]) => n > 0);
  // When the newest policy started coming: what the reports show, not what the site sends today.
  const changedOn = (g: ReportGroup) => {
    const from = r.policies[g.policy]?.first;
    return from === undefined ? '' : dayName(t.locale, from);
  };
  const row = (g: ReportGroup, i: number, fixed: boolean) => (
    <li key={g.key} class={`report-row ${fixed ? 'fixed' : g.explained.violation.reportOnly ? 'reported' : 'blocked'}`}>
      <details>
        <summary>
          <span class="report-row-text">
            <span class="report-row-what">
              <ViolationWhat e={g.explained} />
            </span>{' '}
            <span class="report-row-meta">
              {t('reportsReader.rowMeta', {
                level: fixed ? t('reportsReader.fixed', { date: changedOn(g) }) : t(`reportsReader.risk.level.${g.risk?.level ?? 'low'}`),
                reports: t('reportsReader.stats.reports', { count: g.reports }),
              })}
            </span>
          </span>
        </summary>
        <ViolationItem
          bare
          {...(fixed ? { until: changedOn(g) } : {})}
          e={g.explained}
          index={i}
          source="reports"
          unknown={g.unknown}
          after={g.unknown && <Unknown g={g} trusted={trusted.has(g.key)} onTrust={onTrust} />}
        >
          {fixed ? <p class="report-risk">{t('reportsReader.fixedIntro', { date: changedOn(g) })}</p> : <RiskLine g={g} />}
          {stats(g)}
        </ViolationItem>
      </details>
    </li>
  );
  return (
    <section class="report-results" aria-labelledby="report-results-title">
      <h2 id="report-results-title">{t('reportsReader.title', { count: r.total })}</h2>
      <p>
        {levels.length > 0 && t('reportsReader.summary', { levels: list(levels.map(([level, count]) => t(`reportsReader.levels.${level}`, { count }))) })}
        {r.noise.length > 0 && <> {t('reportsReader.noiseLead', { count: noiseReports })}</>}
        {r.skipped > 0 && <> {t('reportsReader.skipped', { count: r.skipped })}</>}
      </p>
      {r.period && <Period r={r} since={since} onSince={onSince} />}
      {r.total === 0 && <p class="issue">{t('reportsReader.since.none')}</p>}

      {r.readiness.map((ready) => (
        <Enforce key={ready.policy} ready={ready} n={r.policies.length > 1 ? ready.policy + 1 : undefined} />
      ))}

      {r.groups.length + r.allowed.length > 0 && (
        <>
          <h3 class="report-list-title">{t('reportsReader.problems', { count: r.groups.length + r.allowed.length })}</h3>
          <p class="muted">{t('reportsReader.lead')}</p>
          {/* Last, what the newest policy already allows: in the list, marked fixed. */}
          <ol class="report-rows">
            {r.groups.map((g, i) => row(g, i, false))}
            {r.allowed.map((g, i) => row(g, r.groups.length + i, true))}
          </ol>
        </>
      )}

      {r.policies.map((p, i) => {
        if (p.replacedBy !== undefined) return null;
        const lines = r.lines.filter((l) => l.policy === p.text && l.reportOnly === p.reportOnly);
        if (lines.length === 0) return null;
        return (
          <Lines
            key={i}
            lines={lines}
            title={several ? t('reportsReader.linesFor', { n: i + 1 }) : t('violations.lines.title')}
            intro={<p>{t('reportsReader.linesIntro')}</p>}
          >
            <PolicyNotes p={p} />
          </Lines>
        );
      })}

      {r.names.length > 0 && (
        <div class="report-names">
          <h3>{t('reportsReader.names.title')}</h3>
          <p>
            <Rich msg="reportsReader.names.text" vars={{ names: r.names.map((n) => `\`${n.name}\``).join(', ') }} />
          </p>
        </div>
      )}

      {r.policies.length > 1 && <PolicyList policies={r.policies} />}

      {/* What isn't the site's doing, folded at the end: one section per cause, each saying why. */}
      {NOISE_KINDS.map((kind) => {
        const groups = r.noise.filter((g) => g.noise === kind);
        if (groups.length === 0) return null;
        const start = r.groups.length + r.allowed.length + r.noise.indexOf(groups[0]!);
        return (
          <details key={kind} class="report-noise" data-noise={kind}>
            <summary>{t(`reportsReader.noise.${kind}.title`, { count: groups.length, reports: groups.reduce((n, g) => n + g.reports, 0) })}</summary>
            <p>{t(`reportsReader.noise.${kind}.intro`)}</p>
            <ol class="violation-list">
              {groups.map((g, i) => (
                <ViolationItem key={i} e={g.explained} index={start + i} source="reports" setApart>
                  {stats(g)}
                </ViolationItem>
              ))}
            </ol>
          </details>
        );
      })}
    </section>
  );
}

/**
 * "Can you enforce it?", for a report-only policy: not yet (what it would block, how much the lines settle), too soon
 * to say, or ready, with what to do next. The verdict is said in words; its colour only repeats it.
 */
function Enforce({ ready, n }: { ready: Readiness; n: number | undefined }) {
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

/** Several policies sent reports (enforced and report-only, or an older one still cached): each, with its text. */
function PolicyList({ policies }: { policies: ReportPolicy[] }) {
  const t = useT();
  return (
    <details class="report-policies">
      <summary>{t('reportsReader.policies.title', { count: policies.length })}</summary>
      <p>
        {t('reportsReader.policies.intro')}
        {policies.some((p) => p.replacedBy !== undefined) && <> {t('reportsReader.policies.replacedIntro')}</>}
      </p>
      <ol>
        {policies.map((p, i) => (
          <li key={i}>
            <details>
              <summary>
                {p.replacedBy !== undefined
                  ? t('reportsReader.policies.replaced', { n: i + 1, count: p.reports, date: dayName(t.locale, p.last!) })
                  : t(`reportsReader.policies.${p.reportOnly ? 'reportOnly' : p.guessed ? 'guessed' : 'enforced'}`, { n: i + 1, count: p.reports })}
              </summary>
              <pre class="report-policy" tabIndex={0}>
                <code>{p.text || t('reportsReader.policies.missing')}</code>
              </pre>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Under the lines: the whole policy changed, in the comparator, and what Safari didn't say. */
function PolicyNotes({ p }: { p: ReportPolicy }) {
  const t = useT();
  return (
    <>
      {p.guessed && <p class="muted">{t('reportsReader.guessed')}</p>}
      {p.fixed && (
        <p>
          <a href={localePath(t.locale, `/compare#${encodeCompareState({ before: p.fixed.before, after: p.fixed.after, site: '', vendors: {} })}`)}>
            {t('reportsReader.compare')}
          </a>
        </p>
      )}
    </>
  );
}

/** When the reports were received, and the day to read them from. */
function Period({ r, since, onSince }: { r: ExplainedReports; since: string; onSince: (day: string) => void }) {
  const t = useT();
  const { from, to } = r.period!;
  const range = new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium' }).formatRange(from, to);
  return (
    <div class="report-period">
      <p class="muted">{t('reportsReader.period', { range })}</p>
      <p class="report-since">
        <label for="reports-since">{t('reportsReader.since.label')}</label>{' '}
        <input id="reports-since" type="date" value={since} min={dayValue(from)} max={dayValue(to)} onInput={(e) => onSince(e.currentTarget.value)} />
      </p>
      {(r.before > 0 || r.undated > 0) && (
        <p class="muted">
          {r.before > 0 && t('reportsReader.since.left', { count: r.before })}
          {r.before > 0 && r.undated > 0 && ' '}
          {r.undated > 0 && t('reportsReader.since.undated', { count: r.undated })}
        </p>
      )}
    </div>
  );
}

/** A day as people read it ("Nov 13, 2026"), in the visitor's time zone. */
const dayName = (locale: string, time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(time);
/** A day as a date field takes it (`2026-11-13`), in the visitor's time zone. */
function dayValue(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const sameDay = (a: number, b: number) => dayValue(a) === dayValue(b);

/** An address no tool uses, outside the site: why it isn't in the lines, how to check it, and the visitor's word. */
function Unknown({ g, trusted, onTrust }: { g: ReportGroup; trusted: boolean; onTrust: (key: string, host: string, yes: boolean) => void }) {
  const t = useT();
  return (
    <>
      {!trusted && (
        <p class="violation-risk">
          <Rich msg="reportsReader.unknown" vars={{ host: g.explained.host ?? '' }} />
        </p>
      )}
      <label class="report-trust">
        <input type="checkbox" checked={trusted} onChange={(e) => onTrust(g.key, g.explained.host ?? '', e.currentTarget.checked)} /> {t('reportsReader.trust')}
      </label>
    </>
  );
}

/**
 * Why a problem is ranked where it is, when something sets it apart: an unknown address, a checkout or sign-in page,
 * new or gone. Its level is in its row; "blocked" and "a script" are in its status and name already.
 */
const TELLING = new Set(['unknown', 'sensitive', 'new', 'stopped']);
function RiskLine({ g }: { g: ReportGroup }) {
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
  return (
    <p class="report-risk">
      <Rich msg="reportsReader.risk.line" vars={{ level: t(`reportsReader.risk.level.${g.risk!.level}`), reasons: new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(reasons) }} />
    </p>
  );
}

/** How many reports a problem stands for, from which pages and browsers. */
function Stats({ g, policies }: { g: ReportGroup; policies: number }) {
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
      {g.pages.length > 1 && (
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
