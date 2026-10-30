import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { EXAMPLE_POLICY } from '../config';
import { translator, type Locale } from '../i18n';
import { analyze, DEFAULT_ORIGIN, type VendorSelection } from '../lib/analysis';
import type { Vendor } from '../lib/catalogue/schema';
import type { ContentBundle } from '../lib/content';
import type { Audience, ParseResult } from '../lib/csp/model';
import { distinctIssues } from '../lib/csp/parser';
import { track } from '../scripts/track';
import { AllowMap } from './AllowMap';
import { Explanation, issueText } from './Explanation';
import { I18n, useT } from './i18n';
import { PolicyEditor, PolicySummary } from './PolicyInput';
import { PolicyView, type Selection } from './PolicyView';
import { ReportPanel } from './ReportPanel';
import { Segmented } from './Segmented';
import { decodeState, encodeState, loadAudience, saveAudience, toOrigin, VIEWS, type View } from './state';
import { TabList, tabPanelProps } from './Tabs';
import { VendorChecker } from './VendorChecker';
import './analyzer.css';

const AUDIENCES: Audience[] = ['simple', 'developer', 'security'];

/** Small segmented control to pick between several policies (header + meta, comma-separated…). */
function PolicySwitch({ parsed, value, onChange }: { parsed: ParseResult; value: number; onChange: (i: number) => void }) {
  const t = useT();
  if (parsed.policies.length < 2) return null;
  return (
    <Segmented
      class="segmented"
      label={t('analyzer.policies', { count: parsed.policies.length })}
      items={parsed.policies.map((p, i) => ({
        id: i,
        label: t('analyzer.policy', { index: i + 1 }) + (p.reportOnly ? ` (${t('analyzer.reportOnlyShort')})` : ''),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}

interface Props {
  content: ContentBundle;
  locale: Locale;
  /** The tools' texts in the other languages, for an IT message in another language than the page's. */
  otherVendors: Partial<Record<Locale, Vendor[]>>;
}

export default function Analyzer({ content, locale, otherVendors }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(true);
  const [site, setSite] = useState('');
  const [audience, setAudience] = useState<Audience>('simple');
  const [view, setView] = useState<View>('read');
  const [selectedVendors, setSelectedVendors] = useState<Record<string, string[]>>({});
  const [selection, setSelection] = useState<Selection | undefined>();
  const [policyIndex, setPolicyIndex] = useState(0);
  // Usage counts: was the text typed or pasted by the visitor, and was that counted already?
  const typed = useRef(false);
  const counted = useRef(false);

  // Restore from the link and from the remembered audience once, in the browser.
  useEffect(() => {
    const s = decodeState(location.hash);
    setAudience(s.audience ?? loadAudience());
    // Text typed or pasted before hydration would otherwise be wiped.
    const early = (document.getElementById('policy-input') as HTMLTextAreaElement | null)?.value;
    if (s.policy) {
      setInput(s.policy);
      setEditing(false);
      track('shared');
    } else if (early) {
      setInput(early);
      typed.current = true;
    }
    if (s.site) setSite(s.site);
    if (s.vendors) setSelectedVendors(s.vendors);
    if (s.view) setView(s.view);
  }, []);

  // Keep the fragment in sync so the address bar is always a shareable link.
  useEffect(() => {
    const hash = encodeState({ policy: input, site, vendors: selectedVendors, view, audience });
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  }, [input, site, selectedVendors, view, audience]);

  const selections: VendorSelection[] = useMemo(
    () =>
      content.vendors
        .filter((v) => v.id in selectedVendors)
        .map((vendor) => ({ vendor, features: vendor.features.filter((f) => selectedVendors[vendor.id]?.includes(f.id)) })),
    [content.vendors, selectedVendors],
  );

  const origin = toOrigin(site) ?? DEFAULT_ORIGIN;
  const analysis = useMemo(() => analyze(input, selections, origin), [input, selections, origin]);
  const { parsed } = analysis;
  const hasPolicy = input.trim() !== '' && parsed.policies.some((p) => p.directives.length > 0);
  const showEditor = !hasPolicy || editing;
  const currentIndex = Math.min(policyIndex, Math.max(parsed.policies.length - 1, 0));
  const policy = parsed.policies[currentIndex];

  // Select the first directive whenever the policy changes shape, or another policy is shown.
  const activeSelection =
    selection && selection.policyIndex === currentIndex && policy?.directives[selection.directiveIndex]
      ? selection
      : policy && policy.directives.length > 0
        ? { policyIndex: currentIndex, directiveIndex: 0 }
        : undefined;

  // Count one analysis of the visitor's own policy per page load, once they stop typing.
  useEffect(() => {
    if (counted.current || !typed.current || !hasPolicy || input === EXAMPLE_POLICY) return;
    const timer = setTimeout(() => {
      counted.current = true;
      track('analyze');
    }, 1500);
    return () => clearTimeout(timer);
  }, [input, hasPolicy]);

  const setPolicy = (text: string, collapse: boolean) => {
    setInput(text);
    setSelection(undefined);
    setPolicyIndex(0);
    if (collapse) setEditing(false);
  };

  /** Switches view from a button inside a panel, bringing the tabs back into sight. */
  const goTo = (v: View) => {
    setView(v);
    const toolbar = document.querySelector('.workspace');
    if (toolbar && toolbar.getBoundingClientRect().top < 0) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      toolbar.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  };

  const chooseAudience = (a: Audience) => {
    setAudience(a);
    saveAudience(a);
  };


  const issues = distinctIssues(parsed.issues.filter((i) => i.code !== 'empty-input'));
  const blocked = analysis.vendors.filter((v) => v.verdict === 'blocked').length;
  const nonce = analysis.vendors.filter((v) => v.verdict === 'needs-nonce').length;

  const badge = (v: View) => {
    if (v === 'read' && issues.length > 0) return <span class="count count-warn">{t('views.issues', { count: issues.length })}</span>;
    if (v === 'tools' && analysis.vendors.length > 0) {
      if (blocked > 0) return <span class="count count-bad">{t('views.blocked', { count: blocked })}</span>;
      if (nonce > 0) return <span class="count count-warn">{t('views.nonce', { count: nonce })}</span>;
      return <span class="count count-ok">{t('views.allOk')}</span>;
    }
    return null;
  };

  return (
    <I18n.Provider value={t}>
      <div class="analyzer">
        <section class="input-block" aria-labelledby="input-title">
          {showEditor ? (
            <PolicyEditor
              input={input}
              parsed={parsed}
              hasPolicy={hasPolicy}
              site={site}
              onType={(text, collapse) => {
                typed.current = true;
                setPolicy(text, collapse);
              }}
              onExample={() => setPolicy(EXAMPLE_POLICY, true)}
              onSite={setSite}
              onDone={() => setEditing(false)}
            />
          ) : (
            <PolicySummary
              parsed={parsed}
              policy={policy}
              onEdit={() => setEditing(true)}
              onClear={() => {
                setPolicy('', false);
                setEditing(true);
                setView('read');
              }}
            />
          )}
        </section>

        {hasPolicy && policy && (
          <section class="workspace" aria-label={t('views.label')}>
            <div class="toolbar">
              <TabList
                id="view"
                label={t('views.label')}
                value={view}
                onChange={setView}
                items={VIEWS.map((v) => ({
                  id: v,
                  label: (
                    <>
                      <span class="tab-label">{t(`views.${v}`)}</span>
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
                onChange={chooseAudience}
              >
                <span class="audience-label" aria-hidden="true">
                  {t('audience.label')}
                </span>
              </Segmented>
            </div>

            {view === 'read' && (
              <div {...tabPanelProps('view', 'read')} class="panel">
                <div class="panel-head">
                  <PolicySwitch parsed={parsed} value={currentIndex} onChange={setPolicyIndex} />
                  <p class="muted">{t('analyzer.clickHint')}</p>
                </div>
                <div class="decoded-grid">
                  <PolicyView
                    policy={policy}
                    policyIndex={currentIndex}
                    issues={parsed.issues}
                    docs={content.directives}
                    selection={activeSelection}
                    onSelect={setSelection}
                  />
                  {activeSelection && (
                    <div class="explanation-slot">
                      <Explanation policy={policy} selection={activeSelection} issues={parsed.issues} audience={audience} content={content} />
                    </div>
                  )}
                </div>
                {issues.length > 0 && (
                  <div class="issues">
                    <h2>{t('issues.title')}</h2>
                    <ul class="issue-list">
                      {issues.map((i, n) => (
                        <li key={n}>{issueText(t, i)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {view === 'allows' && (
              <div {...tabPanelProps('view', 'allows')} class="panel">
                <div class="panel-head">
                  <PolicySwitch parsed={parsed} value={currentIndex} onChange={setPolicyIndex} />
                  <p class="muted">{t('map.intro')}</p>
                </div>
                <AllowMap policy={policy} origin={origin} audience={audience} content={content} />
              </div>
            )}

            {view === 'tools' && (
              <div {...tabPanelProps('view', 'tools')} class="panel">
                <p class="panel-intro">{t('vendors.intro')}</p>
                <VendorChecker
                  vendors={content.vendors}
                  selected={selectedVendors}
                  checks={analysis.vendors}
                  audience={audience}
                  onChange={setSelectedVendors}
                />
                {analysis.vendors.length > 0 && (
                  <p class="next-step">
                    <button type="button" class="button" onClick={() => goTo('report')}>
                      {t(`report.cta.${audience}`)}
                    </button>
                  </p>
                )}
              </div>
            )}

            {view === 'report' && (
              <div {...tabPanelProps('view', 'report')} class="panel">
                <ReportPanel
                  analysis={analysis}
                  audience={audience}
                  site={site}
                  vendorsIn={{ ...otherVendors, [locale]: content.vendors }}
                  onPickTools={() => goTo('tools')}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </I18n.Provider>
  );
}
