import { useEffect, useMemo, useState } from 'preact/hooks';
import { EXAMPLE_POLICY } from '../config';
import { t } from '../i18n';
import { analyze, DEFAULT_ORIGIN, type VendorSelection } from '../lib/analysis';
import type { ContentBundle } from '../lib/content';
import type { Audience } from '../lib/csp/model';
import { AllowMap } from './AllowMap';
import { Explanation, issueText } from './Explanation';
import { PolicyView, type Selection } from './PolicyView';
import { ReportPanel } from './ReportPanel';
import { decodeState, encodeState, loadAudience, saveAudience, toOrigin } from './state';
import { VendorChecker } from './VendorChecker';
import './analyzer.css';

const AUDIENCES: { id: Audience; hint: string }[] = [
  { id: 'simple', hint: 'audience.simpleHint' },
  { id: 'developer', hint: 'audience.developerHint' },
  { id: 'security', hint: 'audience.securityHint' },
];

export default function Analyzer({ content }: { content: ContentBundle }) {
  const [input, setInput] = useState('');
  const [site, setSite] = useState('');
  const [audience, setAudience] = useState<Audience>('simple');
  const [selectedVendors, setSelectedVendors] = useState<Record<string, string[]>>({});
  const [selection, setSelection] = useState<Selection | undefined>();
  const [policyIndex, setPolicyIndex] = useState(0);
  const [shared, setShared] = useState(false);

  // Restore from the link and from the remembered audience once, in the browser.
  useEffect(() => {
    setAudience(loadAudience());
    const s = decodeState(location.hash);
    // Text typed or pasted before hydration would otherwise be wiped.
    const early = (document.getElementById('policy-input') as HTMLTextAreaElement | null)?.value;
    if (s.policy) setInput(s.policy);
    else if (early) setInput(early);
    if (s.site) setSite(s.site);
    if (s.vendors) setSelectedVendors(s.vendors);
  }, []);

  // Keep the fragment in sync so the address bar is always a shareable link.
  useEffect(() => {
    const hash = encodeState({ policy: input, site, vendors: selectedVendors });
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  }, [input, site, selectedVendors]);

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
  const policy = parsed.policies[Math.min(policyIndex, parsed.policies.length - 1)];
  const currentIndex = policy ? parsed.policies.indexOf(policy) : 0;

  // Select the first directive whenever the policy changes shape.
  const activeSelection =
    selection && parsed.policies[selection.policyIndex]?.directives[selection.directiveIndex]
      ? selection
      : policy && policy.directives.length > 0
        ? { policyIndex: currentIndex, directiveIndex: 0 }
        : undefined;

  const chooseAudience = (a: Audience) => {
    setAudience(a);
    saveAudience(a);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      // The address bar already holds the link.
    }
  };

  const allIssues = parsed.issues.filter((i) => i.code !== 'empty-input');

  return (
    <div class="analyzer">
      <div class="audience" role="radiogroup" aria-label={t('audience.label')}>
        <span class="audience-label" aria-hidden="true">
          {t('audience.label')}
        </span>
        {AUDIENCES.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={audience === a.id} onClick={() => chooseAudience(a.id)}>
            <span class="audience-name">{t(`audience.${a.id}`)}</span>
            <span class="audience-hint">{t(a.hint)}</span>
          </button>
        ))}
      </div>

      <section class="input-block" aria-labelledby="input-title">
        <h1 id="input-title">
          <label for="policy-input">{t('analyzer.inputLabel')}</label>
        </h1>
        <p class="muted">{t('analyzer.inputHint')}</p>
        <textarea
          id="policy-input"
          class="code"
          rows={5}
          spellcheck={false}
          autocomplete="off"
          placeholder={t('analyzer.placeholder')}
          value={input}
          onInput={(e) => {
            setInput(e.currentTarget.value);
            setSelection(undefined);
          }}
        />
        <div class="input-actions">
          <button type="button" class="button quiet" onClick={() => setInput(EXAMPLE_POLICY)}>
            {t('analyzer.example')}
          </button>
          {input && (
            <>
              <button type="button" class="button quiet" onClick={() => setInput('')}>
                {t('analyzer.clear')}
              </button>
              <button type="button" class="button quiet" onClick={share} title={t('analyzer.shareHint')}>
                {shared ? t('analyzer.shared') : t('analyzer.share')}
              </button>
            </>
          )}
          <p class="find-hint">
            {t('analyzer.noPolicy')} <a href="/find-my-csp">{t('analyzer.findLink')}</a>
          </p>
        </div>
        <details class="site-field">
          <summary>{t('analyzer.siteLabel')}</summary>
          <input type="text" inputMode="url" value={site} placeholder="www.example.com" onInput={(e) => setSite(e.currentTarget.value)} />
          <p class="muted">{t('analyzer.siteHint')}</p>
        </details>
      </section>

      {!hasPolicy ? (
        input.trim() !== '' && <p class="issue">{t('issues.empty-input')}</p>
      ) : (
        policy && (
          <>
            <section class="decoded" aria-labelledby="decoded-title">
              <h2 id="decoded-title" class="visually-hidden">
                {t('analyzer.policy', { index: currentIndex + 1 })}
              </h2>
              {parsed.policies.length > 1 && (
                <div class="tabs" role="tablist" aria-label={t('analyzer.policies', { count: parsed.policies.length })}>
                  {parsed.policies.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={i === currentIndex}
                      onClick={() => {
                        setPolicyIndex(i);
                        setSelection(undefined);
                      }}
                    >
                      {t('analyzer.policy', { index: i + 1 })}
                      {p.reportOnly && ' (report-only)'}
                    </button>
                  ))}
                </div>
              )}
              <p class="policy-meta">
                <span class={policy.reportOnly ? 'badge badge-report' : 'badge'}>{policy.reportOnly ? t('analyzer.reportOnly') : t('analyzer.enforced')}</span>
                {policy.origin === 'header' && <span class="muted">{t('analyzer.fromHeader')}</span>}
                {policy.origin === 'meta' && <span class="muted">{t('analyzer.fromMeta')}</span>}
                <span class="muted">{t('analyzer.clickHint')}</span>
              </p>
              <div class="decoded-grid">
                <PolicyView
                  policy={policy}
                  policyIndex={currentIndex}
                  issues={parsed.issues}
                  docs={content.directives}
                  selection={activeSelection}
                  onSelect={setSelection}
                />
                {activeSelection && activeSelection.policyIndex === currentIndex && (
                  <div class="explanation-slot">
                    <Explanation policy={policy} selection={activeSelection} issues={parsed.issues} audience={audience} content={content} />
                  </div>
                )}
              </div>
            </section>

            {allIssues.length > 0 && (
              <section aria-labelledby="issues-title">
                <h2 id="issues-title">{t('issues.title')}</h2>
                <ul class="issue-list">
                  {allIssues.map((i, n) => (
                    <li key={n}>{issueText(i)}</li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="map-title">
              <h2 id="map-title">{t('map.title')}</h2>
              <p class="muted">{t('map.intro')}</p>
              <AllowMap policy={policy} origin={origin} audience={audience} content={content} />
            </section>

            <section aria-labelledby="vendors-title">
              <h2 id="vendors-title">{t('vendors.title')}</h2>
              <p>{t('vendors.intro')}</p>
              <VendorChecker
                vendors={content.vendors}
                selected={selectedVendors}
                checks={analysis.vendors}
                audience={audience}
                onChange={setSelectedVendors}
              />
            </section>

            <section aria-labelledby="report-title" class="report-section">
              <h2 id="report-title">
                {t('report.title')}: {t(`audience.${audience}`)}
              </h2>
              <ReportPanel analysis={analysis} audience={audience} site={site} />
            </section>
          </>
        )
      )}
    </div>
  );
}
