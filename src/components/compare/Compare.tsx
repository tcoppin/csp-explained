import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COMPARE_EXAMPLE } from '../../config';
import { translator, type Locale } from '../../i18n';
import { DEFAULT_ORIGIN, type VendorSelection } from '../../lib/analysis';
import { compare } from '../../lib/comparison';
import type { ContentBundle } from '../../lib/content';
import type { Audience, ParseResult } from '../../lib/csp/model';
import { track } from '../../scripts/track';
import { SiteField } from '../policy/SiteField';
import { loadAudience, toOrigin } from '../policy/state';
import { I18n, useT } from '../ui/i18n';
import { decodeCompareState, encodeCompareState, type CompareView } from './compare-state';
// Shared view styles first, so the comparator's own rules win when they tie
import '../ui/panels.css';
import '../policy/results.css';
import './compare.css';

type Side = 'before' | 'after';

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

  const changed = comparison.policies.reduce((n, p) => n + p.directives.filter((d) => d.status !== 'unchanged').length, 0);
  const same = comparison.policies.every((p) => p.status === 'unchanged');

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

        {ready ? (
          <section class="compare-results" aria-labelledby="compare-results-title">
            <h2 id="compare-results-title">{t('compare.results')}</h2>
            <p class="compare-summary" aria-live="polite">
              {same ? t('compare.same') : t('compare.changedRules', { count: changed })}
            </p>
          </section>
        ) : (
          <p class="muted compare-waiting">{t('compare.waiting')}</p>
        )}
      </div>
    </I18n.Provider>
  );
}
