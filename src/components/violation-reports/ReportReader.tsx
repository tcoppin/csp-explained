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
import { dayName, dayValue, Enforce, Quotes, RiskLine, Stats, Summary } from './parts';
import { DEFAULT_SAVE, linesTitle, ReportsDocument, reportsDocumentTitle, type SaveOptions } from './ReportsDocument';
import { downloadFile, documentFile, printDocument } from '../ui/document';
import { markdownOf } from '../ui/markdown';
import { useCopy } from '../ui/useCopy';
import { printTitle } from '../../lib/reports/export';
import { resultsCsv, resultsJson, type ResultsMeta } from '../../lib/reports/violation-results';
import css from './reports-document.css?raw';
import './reports-document.css';
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

type Loaded = { kind: 'none' } | { kind: 'example' } | { kind: 'file'; name: string; size: number };

/**
 * Reads a batch of violation reports (pasted, or opened from a file) on the visitor's device: the problems they
 * stand for, riskiest first, what the site didn't cause set apart, and the lines that allow the rest. Once read, the
 * box folds into a bar (what was read, when, and "Change"), so the results start near the top. Nothing is kept: not
 * in the address, not in the browser's storage.
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
  // Domains the visitor says are theirs (a CDN of their own): every address on them goes in. Forgotten likewise.
  const [own, setOwn] = useState<ReadonlySet<string>>(new Set());
  // The checkbox just changed: its row can move in the list, and the focus must not be lost with it.
  const refocus = useRef<string | undefined>(undefined);
  const [trustNote, setTrustNote] = useState('');
  // "Only the reports since": a day (`YYYY-MM-DD`), from its start in the visitor's time zone.
  const [since, setSince] = useState('');
  const sinceTime = since ? new Date(`${since}T00:00`).getTime() : undefined;
  // The box, open; folded into a bar once reports are read from a paste, a file or the example.
  const [editing, setEditing] = useState(true);

  // Read once; explained again (quickly) when the visitor vouches for an address or picks a day.
  const read = useMemo(() => (text.trim() === '' ? undefined : readReports(text)), [text]);
  const result = useMemo(
    () => (read ? explainReports(read, content.vendors, { trusted, own, ...(sinceTime !== undefined && Number.isFinite(sinceTime) ? { since: sinceTime } : {}) }) : undefined),
    [read, content.vendors, trusted, own, sinceTime],
  );

  /** New reports: what was vouched for went with the old ones. `fold`: a whole batch at once (not typing). */
  function load(next: string, from: Loaded, fold = false) {
    setText(next);
    setLoaded(from);
    if (fold) setEditing(false);
    setTrusted(new Set());
    setOwn(new Set());
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
    refocus.current = document.activeElement?.id;
    setTrustNote(t(`reportsReader.trusted.${yes ? 'added' : 'removed'}`, { host }));
  }

  function ownSite(site: string, yes: boolean) {
    const next = new Set(own);
    if (yes) next.add(site);
    else next.delete(site);
    setOwn(next);
    refocus.current = document.activeElement?.id;
    setTrustNote(t(`reportsReader.own.${yes ? 'added' : 'removed'}`, { site }));
  }

  // After vouching for an address or a domain, its row may have moved: the focus goes back to the checkbox if lost.
  useLayoutEffect(() => {
    const id = refocus.current;
    refocus.current = undefined;
    if (!id) return;
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(id)?.focus();
  });

  // Count one batch read per page load, never what it holds; not the example.
  useEffect(() => {
    if (counted.current || !read || read.reports.length === 0 || loaded.kind === 'example') return;
    counted.current = true;
    track('read-reports', { from: loaded.kind === 'file' ? 'file' : 'paste' });
  }, [read, loaded]);

  const hasReports = !!read && read.reports.length > 0;
  const folded = hasReports && !editing;

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

  // Folding or unfolding takes away the control that was pressed: the focus goes to the results' heading, or back
  // to the box (or "Open a file", for a file). Only a focus that was lost is moved.
  const wasFolded = useRef(folded);
  const openButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (wasFolded.current === folded) return;
    wasFolded.current = folded;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (folded) document.getElementById('report-results-title')?.focus();
    else (textArea.current ?? openButton.current)?.focus();
  }, [folded]);

  async function open(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    if (file.size > MAX_BYTES) {
      setError('tooLarge');
      return;
    }
    try {
      load(await file.text(), { kind: 'file', name: file.name, size: file.size }, true);
    } catch {
      setError('unreadable');
    }
  }

  function clear() {
    cleared.current = document.activeElement;
    load('', { kind: 'none' });
    setEditing(true);
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
          {folded ? (
            <>
              <div class="report-bar">
                <p>
                  <strong>
                    {loaded.kind === 'file' ? loaded.name : t(`reportsReader.bar.${loaded.kind === 'example' ? 'example' : 'pasted'}`)}
                  </strong>
                  {t('reportsReader.bar.sep')}
                  {t('reportsReader.bar.count', { count: read!.reports.length })}
                </p>
                <div class="report-bar-actions">
                  <button type="button" class="button quiet" onClick={() => setEditing(true)}>
                    {t('reportsReader.bar.change')}
                  </button>
                  <button type="button" class="button quiet" onClick={clear}>
                    {t('analyzer.clear')}
                  </button>
                </div>
              </div>
              {result?.period && <Period r={result} since={since} onSince={pickSince} />}
            </>
          ) : (
            <>
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
                    onPaste={(e) => {
                      // A paste into the empty box is a whole batch: show the results right away.
                      const pasted = e.clipboardData?.getData('text') ?? '';
                      if (pasted.trim() && !text.trim()) {
                        e.preventDefault();
                        load(pasted, { kind: 'none' }, true);
                      }
                    }}
                  />
                </>
              )}
              <p id="reports-hint" class="muted format-hint">
                {t('reportsReader.hint')}
              </p>
              <div class="actions">
                <button type="button" class="button" ref={openButton} onClick={() => fileInput.current?.click()}>
                  {t('reportsReader.openFile')}
                </button>
                {text.trim() === '' ? (
                  <button
                    type="button"
                    class="button quiet"
                    onClick={() => {
                      track('example');
                      setError(undefined);
                      load(EXAMPLE_REPORTS, { kind: 'example' }, true);
                    }}
                  >
                    {t('analyzer.example')}
                  </button>
                ) : (
                  <>
                    {hasReports && (
                      <button type="button" class="button quiet" onClick={() => setEditing(false)}>
                        {t('reportsReader.bar.done')}
                      </button>
                    )}
                    <button type="button" class="button quiet" onClick={clear}>
                      {t('analyzer.clear')}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
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
          {error && <p class="issue">{t(`reportsReader.error.${error}`, { max: size(MAX_BYTES) })}</p>}
        </section>

        {/* Always in the page, so the result is announced as it appears; then what the visitor vouched for. */}
        <p class="visually-hidden" role="status">
          {trustNote ||
            (read && result && (read.reports.length === 0 ? t('reportsReader.none') : since ? t('reportsReader.since.announce', { count: result.total, date: dayName(t.locale, sinceTime!) }) : t('reportsReader.announce', { count: result.total })))}
        </p>
        {read && result &&
          (read.reports.length > 0 ? (
            <Results
              r={result}
              trusted={trusted}
              onTrust={trust}
              onOwn={ownSite}
              own={own}
              since={since}
              onSince={pickSince}
              period={!folded}
              source={loaded.kind === 'file' ? loaded.name : t(`reportsReader.bar.${loaded.kind === 'example' ? 'example' : 'pasted'}`)}
              sinceTime={since && sinceTime !== undefined && Number.isFinite(sinceTime) ? sinceTime : undefined}
            />
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
  own: ReadonlySet<string>;
  onOwn: (site: string, yes: boolean) => void;
  since: string;
  onSince: (day: string) => void;
  /** When the reports were received, here: the bar shows it once the box is folded. */
  period: boolean;
  /** What was read, for the saved copy: the example, a file's name, or pasted reports. */
  source: string;
  sinceTime: number | undefined;
}

const LEVELS = ['high', 'medium', 'low'] as const;

/**
 * What the reports come to: a sentence of counts and the verdict on enforcing; then the problems, one row each,
 * riskiest first, opening to their detail (the warnings come before the lines), and last what an older policy blocked
 * that the newest one in the reports allows, since the day it started coming (the reports can't say it is still the
 * one the site sends); then the lines that allow them; and what the site didn't cause, folded at
 * the end.
 */
function Results({ r, trusted, onTrust, own, onOwn, since, onSince, period, source, sinceTime }: ResultsProps) {
  const t = useT();
  // Older versions get no lines of their own: their reports were read against the newest.
  const several = r.policies.filter((p) => p.replacedBy === undefined).length > 1;
  const noiseReports = r.noise.reduce((n, g) => n + g.reports, 0);
  const stats = (g: ReportGroup) => <Stats g={g} policies={several ? r.policies.length : 0} />;
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
            {/* The level in words, highlighted in its colour; the order and the colour only repeat it. */}
            <span class="report-row-level">
              <span class={`report-level ${fixed ? 'fixed' : (g.risk?.level ?? 'low')}`}>
                {fixed ? t('reportsReader.fixed') : t(`reportsReader.risk.level.${g.risk?.level ?? 'low'}`)}
              </span>
            </span>{' '}
            <span class="report-row-what">
              <ViolationWhat e={g.explained} />
            </span>{' '}
            <span class="report-row-meta">
              {fixed
                ? t('reportsReader.fixedMeta', { date: changedOn(g), reports: t('reportsReader.stats.reports', { count: g.reports }) })
                : t('reportsReader.stats.reports', { count: g.reports })}
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
          after={(g.unknown || g.own) && <Unknown g={g} trusted={trusted.has(g.key)} onTrust={onTrust} onOwn={onOwn} />}
        >
          {fixed ? <p class="report-risk">{t('reportsReader.fixedIntro', { date: changedOn(g) })}</p> : <RiskLine g={g} />}
          {stats(g)}
          <Quotes g={g} />
        </ViolationItem>
      </details>
    </li>
  );
  return (
    <section class="report-results" aria-labelledby="report-results-title">
      <h2 id="report-results-title" tabIndex={-1}>
        {t('reportsReader.title', { count: r.total })}
      </h2>
      {levels.length > 0 && (
        <p class="report-summary">
          <Summary levels={levels} />
        </p>
      )}
      {(r.noise.length > 0 || r.skipped > 0) && (
        <p class="muted">
          {r.noise.length > 0 && t('reportsReader.noiseLead', { count: noiseReports })}
          {r.noise.length > 0 && r.skipped > 0 && ' '}
          {r.skipped > 0 && t('reportsReader.skipped', { count: r.skipped })}
        </p>
      )}
      {period && r.period && <Period r={r} since={since} onSince={onSince} />}
      {r.total === 0 && <p class="issue">{t('reportsReader.since.none')}</p>}

      {r.readiness.map((ready) => (
        <Enforce key={ready.policy} ready={ready} n={r.policies.length > 1 ? ready.policy + 1 : undefined} />
      ))}

      {r.groups.length + r.allowed.length > 0 && (
        <>
          <h3 class="report-list-title">{t('reportsReader.problems', { count: r.groups.length + r.allowed.length })}</h3>
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
            // With dates, which policy the lines are built on: the one sent from its first report on.
            title={linesTitle(t, p, several ? i + 1 : undefined)}
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

      {/* What isn't the site's doing, folded at the end: one fold, a part per cause saying why. */}
      {r.noise.length > 0 && (
        <details class="report-noise">
          <summary>{t('reportsReader.noiseTitle', { count: noiseReports })}</summary>
          {NOISE_KINDS.map((kind) => {
            const groups = r.noise.filter((g) => g.noise === kind);
            if (groups.length === 0) return null;
            const start = r.groups.length + r.allowed.length + r.noise.indexOf(groups[0]!);
            return (
              <div key={kind} class="report-noise-cause" data-noise={kind}>
                <p class="report-noise-name">
                  <strong>{t(`reportsReader.noise.${kind}.name`)}</strong> {t('reportsReader.noiseCount', { count: groups.reduce((n, g) => n + g.reports, 0) })}
                </p>
                <p>
                  <Rich msg={`reportsReader.noise.${kind}.intro`} />
                </p>
                <ol class="violation-list">
                  {groups.map((g, i) => (
                    <ViolationItem key={i} e={g.explained} index={start + i} source="reports" setApart>
                      {stats(g)}
                    </ViolationItem>
                  ))}
                </ol>
              </div>
            );
          })}
        </details>
      )}

      <SaveResults r={r} source={source} since={sinceTime} trusted={trusted} own={own} />
    </section>
  );
}

/**
 * Saving the results to share with a team or keep: printed or saved as PDF, a standalone .html file, or Markdown
 * (a file, or copied for a ticket or a chat). Made on the device from what the page shows; never the reports.
 */
function SaveResults({ r, source, since, trusted, own }: { r: ExplainedReports; source: string; since: number | undefined; trusted: ReadonlySet<string>; own: ReadonlySet<string> }) {
  const t = useT();
  const [options, setOptions] = useState<SaveOptions>(DEFAULT_SAVE);
  const { copied, copy } = useCopy(() => track('export-reports', { format: 'copy' }));
  const doc = () => <ReportsDocument t={t} r={r} options={options} source={source} {...(since !== undefined ? { since } : {})} trusted={trusted} own={own} date={new Date()} />;
  const title = reportsDocumentTitle(t);
  const meta = (): ResultsMeta => ({ source, date: new Date(), ...(since !== undefined ? { since } : {}), ...options, own: [...own].sort() });
  const name = (ext: string) => `csp-violation-reports-${dayValue(Date.now())}.${ext}`;
  const option = (key: keyof SaveOptions) => (
    <label>
      <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.currentTarget.checked })} /> {t(`reportsReader.save.include.${key}`)}
    </label>
  );
  return (
    <fieldset class="save-copy report-save">
      <legend>{t('report.export.title')}</legend>
      <div class="save-options">
        {option('pages')}
        {option('samples')}
        {option('policies')}
      </div>
      <div class="actions">
        <button
          type="button"
          class="button"
          onClick={() => {
            track('export-reports', { format: 'pdf' });
            printDocument(doc(), printTitle(title, r.origin ?? ''));
          }}
        >
          {t('report.export.print')}
        </button>
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            track('export-reports', { format: 'html' });
            downloadFile(name('html'), documentFile(doc(), title, t.locale, css), 'text/html');
          }}
        >
          {t('report.export.html')}
        </button>
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            track('export-reports', { format: 'md' });
            downloadFile(name('md'), markdownOf(doc()), 'text/markdown');
          }}
        >
          {t('report.export.md')}
        </button>
        <button type="button" class="button quiet" onClick={() => copy(markdownOf(doc()))}>
          {copied ? t('report.copied') : t('reportsReader.save.copy')}
        </button>
        {/* For a spreadsheet, a tracker or a SIEM: one row or record per problem. */}
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            track('export-reports', { format: 'csv' });
            downloadFile(name('csv'), resultsCsv(r, t, meta()), 'text/csv');
          }}
        >
          {t('reportsReader.save.csvButton')}
        </button>
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            track('export-reports', { format: 'json' });
            downloadFile(name('json'), resultsJson(r, t, meta()), 'application/json');
          }}
        >
          {t('reportsReader.save.jsonButton')}
        </button>
      </div>
      <p class="muted format-hint">{t('reportsReader.save.hint')}</p>
    </fieldset>
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

/** An address no tool uses, outside the site: why it isn't in the lines, how to check it, and the visitor's word. */
function Unknown({
  g,
  trusted,
  onTrust,
  onOwn,
}: {
  g: ReportGroup;
  trusted: boolean;
  onTrust: (key: string, host: string, yes: boolean) => void;
  onOwn: (site: string, yes: boolean) => void;
}) {
  const t = useT();
  // Ids, so that the focus can find its checkbox again once the row has moved.
  const id = (kind: string) => `${kind}-${g.key.replace(/[^\w-]/g, '_')}`;
  return (
    <>
      {g.unknown && !trusted && (
        <p class="violation-risk">
          <Rich msg="reportsReader.unknown" vars={{ host: g.explained.host ?? '' }} />
        </p>
      )}
      {g.unknown && (
        <label class="report-trust">
          <input id={id('trust')} type="checkbox" checked={trusted} onChange={(e) => onTrust(g.key, g.explained.host ?? '', e.currentTarget.checked)} /> {t('reportsReader.trust')}
        </label>
      )}
      {g.site && (
        <label class="report-trust">
          <input id={id('own')} type="checkbox" checked={g.own === true} onChange={(e) => onOwn(g.site!, e.currentTarget.checked)} />{' '}
          {t('reportsReader.ownLabel', { site: g.site })}
        </label>
      )}
    </>
  );
}

