import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COMPARE_EXAMPLE } from '../../config';
import { translator, type Locale } from '../../i18n';
import { DEFAULT_ORIGIN, type VendorSelection } from '../../lib/analysis';
import { compare } from '../../lib/comparison';
import type { ContentBundle } from '../../lib/content';
import type { Audience, ParseResult } from '../../lib/csp/model';
import { track } from '../../scripts/track';
import { FindingList } from '../policy/FindingList';
import { SiteField } from '../policy/SiteField';
import { loadAudience, saveAudience, toOrigin } from '../policy/state';
import { I18n, useT } from '../ui/i18n';
import { Segmented } from '../ui/Segmented';
import { TabList, tabPanelProps } from '../ui/Tabs';
import { ChangesView } from './ChangesView';
import { COMPARE_VIEWS, decodeCompareState, encodeCompareState, loadDiffLayout, saveDiffLayout, type CompareView, type DiffLayout } from './compare-state';
import { DiffView } from './DiffView';
import { ToolsChange } from './ToolsChange';
// Shared view styles first, so the comparator's own rules win when they tie
import '../ui/panels.css';
import '../policy/results.css';
import './compare.css';

type Side = 'before' | 'after';

const AUDIENCES: Audience[] = ['simple', 'developer', 'security'];

const hasDirectives = (parsed: ParseResult) => parsed.policies.some((p) => p.directives.length > 0);

interface FieldProps {
  side: Side;
  value: string;
  parsed: ParseResult;
  onType: (text: string) => void;
}

/** One of the two policies: its label, what it usually is, and a problem with what was pasted. */
function PolicyField({ side, value, parsed, onType }: FieldProps) {
  const t = useT();
  const id = `${side}-input`;
  const unreadable = value.trim() !== '' && !hasDirectives(parsed);
  return (
    <div class={`compare-field compare-${side}`}>
      <label for={id} class="compare-label">
        {t(`compare.${side}`)}
      </label>
      <p class="muted compare-hint" id={`${id}-hint`}>
        {t(`compare.${side}Hint`)}
      </p>
      <textarea
        id={id}
        class="code"
        rows={6}
        spellcheck={false}
        autocomplete="off"
        placeholder={t('analyzer.placeholder')}
        aria-describedby={`${id}-hint${unreadable ? ` ${id}-issue` : ''}`}
        aria-invalid={unreadable}
        value={value}
        onInput={(e) => onType(e.currentTarget.value)}
      />
      {unreadable && (
        <p class="issue" id={`${id}-issue`}>
          {t('issues.empty-input')}
        </p>
      )}
    </div>
  );
}

interface Props {
  content: ContentBundle;
  locale: Locale;
}

export default function Compare({ content, locale }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [site, setSite] = useState('');
  const [vendors, setVendors] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<CompareView>('changes');
  const [audience, setAudience] = useState<Audience>('simple');
  const [pairIndex, setPairIndex] = useState(0);
  const [diffLayout, setDiffLayout] = useState<DiffLayout>('tracked');
  // Usage counts: were both policies typed or pasted by the visitor, and was that counted already?
  const typed = useRef(false);
  const counted = useRef(false);

  // Restore from the link and from the remembered audience once, in the browser.
  useEffect(() => {
    const s = decodeCompareState(location.hash);
    setAudience(s.audience ?? loadAudience());
    // Text typed or pasted before hydration would otherwise be wiped.
    const early = (side: Side) => (document.getElementById(`${side}-input`) as HTMLTextAreaElement | null)?.value ?? '';
    const b = s.before ?? early('before');
    const a = s.after ?? early('after');
    if (s.before === undefined && s.after === undefined && (b || a)) typed.current = true;
    setBefore(b);
    setAfter(a);
    if (s.site) setSite(s.site);
    if (s.vendors) setVendors(s.vendors);
    if (s.view) setView(s.view);
    setDiffLayout(loadDiffLayout());
  }, []);

  // Keep the fragment in sync so the address bar is always a shareable link.
  useEffect(() => {
    const hash = encodeCompareState({ before, after, site, vendors, view, audience });
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  }, [before, after, site, vendors, view, audience]);

  const selections: VendorSelection[] = useMemo(
    () =>
      content.vendors
        .filter((v) => v.id in vendors)
        .map((vendor) => ({ vendor, features: vendor.features.filter((f) => vendors[vendor.id]?.includes(f.id)) })),
    [content.vendors, vendors],
  );
  const origin = toOrigin(site) ?? DEFAULT_ORIGIN;
  const comparison = useMemo(() => compare(before, after, selections, origin), [before, after, selections, origin]);
  const ready = hasDirectives(comparison.before) && hasDirectives(comparison.after);
  const isExample = before === COMPARE_EXAMPLE.before && after === COMPARE_EXAMPLE.after;

  // Count one comparison of the visitor's own policies per page load, once they stop typing.
  useEffect(() => {
    if (counted.current || !typed.current || !ready || isExample) return;
    const timer = setTimeout(() => {
      counted.current = true;
      track('compare');
    }, 1500);
    return () => clearTimeout(timer);
  }, [before, after, ready, isExample]);

  const type = (side: Side) => (text: string) => {
    typed.current = true;
    (side === 'before' ? setBefore : setAfter)(text);
  };

  // Pairs where something changed come first; a pair the browser reads the same way is still listed.
  const pairs = comparison.policies;
  const current = Math.min(pairIndex, Math.max(pairs.length - 1, 0));
  const pair = pairs[current];
  const multiple = pairs.length > 1;
  const policyTag = (side: Side) => (f: { policyIndex: number }) => {
    if (!multiple) return undefined;
    const i = pairs.findIndex((p) => (side === 'before' ? p.beforeIndex : p.afterIndex) === f.policyIndex);
    return t('analyzer.policy', { index: i + 1 });
  };
  const worse = comparison.vendors.filter((v) => v.trend === 'worse').length;
  const better = comparison.vendors.filter((v) => v.trend === 'better').length;

  /** A view's status, as in the analyzer: the full text, and the short form for phones. */
  const status = (v: CompareView): { tone: 'ok' | 'warn' | 'bad'; text: string; short: string } | null => {
    if (v === 'changes' && pairs.every((p) => p.status === 'unchanged')) return { tone: 'ok', text: t('compare.views.same'), short: '=' };
    if (v === 'security') {
      const n = comparison.introduced.length;
      if (n > 0) return { tone: 'bad', text: t('compare.views.introduced', { count: n }), short: `+${n}` };
      if (comparison.fixed.length > 0) return { tone: 'ok', text: t('compare.views.fixed', { count: comparison.fixed.length }), short: `−${comparison.fixed.length}` };
    }
    if (v === 'tools' && comparison.vendors.length > 0) {
      if (worse > 0) return { tone: 'bad', text: t('compare.views.worse', { count: worse }), short: String(worse) };
      if (better > 0) return { tone: 'ok', text: t('compare.views.better', { count: better }), short: String(better) };
      // Unchanged is only good news when every tool works.
      const tone = comparison.vendors.every((x) => x.verdictAfter === 'allowed') ? 'ok' : 'warn';
      return { tone, text: t('compare.views.toolsSame'), short: '=' };
    }
    return null;
  };
  const badge = (v: CompareView) => {
    const s = status(v);
    return (
      s && (
        <span class={`count count-${s.tone}`}>
          <span class="view-full">{s.text}</span>
          <span class="view-short" aria-hidden="true">
            {s.short}
          </span>
        </span>
      )
    );
  };
  const currentStatus = status(view);

  const pairSwitch = multiple && (
    <Segmented
      class="segmented"
      label={t('analyzer.policies', { count: pairs.length })}
      items={pairs.map((p, i) => ({
        id: i,
        label: t('analyzer.policy', { index: i + 1 }) + ((p.after ?? p.before)?.reportOnly ? ` (${t('analyzer.reportOnlyShort')})` : ''),
      }))}
      value={current}
      onChange={setPairIndex}
    />
  );

  return (
    <I18n.Provider value={t}>
      <div class="comparator">
        <section class="compare-inputs" aria-label={t('compare.inputsLabel')}>
          <div class="compare-pair">
            <PolicyField side="before" value={before} parsed={comparison.before} onType={type('before')} />
            <PolicyField side="after" value={after} parsed={comparison.after} onType={type('after')} />
          </div>
          <p class="muted format-hint">{t('analyzer.inputHint')}</p>
          <div class="actions">
            {before.trim() === '' && after.trim() === '' ? (
              <button
                type="button"
                class="button quiet"
                onClick={() => {
                  track('example');
                  setBefore(COMPARE_EXAMPLE.before);
                  setAfter(COMPARE_EXAMPLE.after);
                }}
              >
                {t('analyzer.example')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  class="button quiet"
                  onClick={() => {
                    setBefore(after);
                    setAfter(before);
                  }}
                >
                  {t('compare.swap')}
                </button>
                <button
                  type="button"
                  class="button quiet"
                  onClick={() => {
                    setBefore('');
                    setAfter('');
                    setView('changes');
                  }}
                >
                  {t('analyzer.clear')}
                </button>
              </>
            )}
          </div>
          <SiteField site={site} onSite={setSite} />
        </section>

        {ready && pair ? (
          <section class="workspace" aria-label={t('compare.views.label')}>
            <div class="toolbar">
              <TabList
                id="compare-view"
                label={t('compare.views.label')}
                value={view}
                onChange={setView}
                items={COMPARE_VIEWS.map((v) => ({
                  id: v,
                  label: (
                    <>
                      <span class="tab-label">
                        <span class="view-full">{t(`compare.views.${v}`)}</span>
                        <span class="view-short" aria-hidden="true">
                          {t(`compare.views.short.${v}`)}
                        </span>
                      </span>
                      {badge(v)}
                    </>
                  ),
                }))}
              />
              <Segmented
                class="audience"
                label={t('audience.label')}
                items={AUDIENCES.map((a) => ({ id: a, label: t(`audience.${a}`), title: t(`audience.${a}Hint`) }))}
                value={audience}
                onChange={(a) => {
                  setAudience(a);
                  saveAudience(a);
                }}
              >
                <span class="audience-label" aria-hidden="true">
                  {t('audience.label')}
                </span>
              </Segmented>
            </div>
            {currentStatus && (
              <p class="view-status">
                <span class={`count count-${currentStatus.tone}`}>{currentStatus.text}</span>
              </p>
            )}

            {view === 'changes' && (
              <div {...tabPanelProps('compare-view', 'changes')} class="panel">
                {pairSwitch && <div class="panel-head">{pairSwitch}</div>}
                <ChangesView pair={pair} audience={audience} content={content} />
              </div>
            )}

            {view === 'diff' && (
              <div {...tabPanelProps('compare-view', 'diff')} class="panel">
                <div class="panel-head">
                  {pairSwitch}
                  <p class="muted">{t('compare.diff.intro')}</p>
                  {/* Phones have room for one policy only: the switch and the columns are for wider screens. */}
                  <Segmented
                    class="segmented diff-layout"
                    label={t('compare.diff.layout')}
                    items={(['tracked', 'columns'] as const).map((id) => ({ id, label: t(`compare.diff.${id}`) }))}
                    value={diffLayout}
                    onChange={(layout) => {
                      setDiffLayout(layout);
                      saveDiffLayout(layout);
                    }}
                  />
                </div>
                {diffLayout === 'columns' && <DiffView pair={pair} content={content} layout="columns" />}
                <DiffView pair={pair} content={content} layout="tracked" wideHidden={diffLayout === 'columns'} />
              </div>
            )}

            {view === 'security' && (
              <div {...tabPanelProps('compare-view', 'security')} class="panel">
                <h3>{t('compare.security.introduced')}</h3>
                {comparison.introduced.length === 0 ? (
                  <p>{t('compare.security.noneIntroduced')}</p>
                ) : (
                  <FindingList findings={comparison.introduced} tag={policyTag('after')} />
                )}
                <h3>{t('compare.security.fixed')}</h3>
                {comparison.fixed.length === 0 ? <p>{t('compare.security.noneFixed')}</p> : <FindingList findings={comparison.fixed} tag={policyTag('before')} />}
                {comparison.remaining.length > 0 && (
                  <details class="remaining">
                    <summary>{t('compare.security.remaining', { count: comparison.remaining.length })}</summary>
                    <FindingList findings={comparison.remaining} tag={policyTag('after')} />
                  </details>
                )}
                <p class="muted">{t('report.security.attribution')}</p>
              </div>
            )}

            {view === 'tools' && (
              <div {...tabPanelProps('compare-view', 'tools')} class="panel">
                <p class="panel-intro">{t('compare.tools.intro')}</p>
                <ToolsChange vendors={content.vendors} selected={vendors} changes={comparison.vendors} audience={audience} onChange={setVendors} />
              </div>
            )}
          </section>
        ) : (
          <p class="muted compare-waiting">{t('compare.waiting')}</p>
        )}
      </div>
    </I18n.Provider>
  );
}
