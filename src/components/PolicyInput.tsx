import { localePath, type Translate } from '../i18n';
import type { ParseResult, Policy } from '../lib/csp/model';
import { track } from '../scripts/track';
import { useT } from './i18n';
import { Rich } from './Rich';
import { useCopy } from './useCopy';

/** Why nothing could be analysed: a pasted console error gets its own explanation. */
function emptyMessage(t: Translate, issues: ParseResult['issues']): string {
  const violation = issues.find((i) => i.code === 'violation-message');
  if (!violation) return t('issues.empty-input');
  return violation.directive ? t('issues.violation-message', { directive: violation.directive }) : t('issues.violation-message-unnamed');
}

interface EditorProps {
  input: string;
  parsed: ParseResult;
  hasPolicy: boolean;
  site: string;
  /** Text typed or pasted by the visitor; `collapse` folds the editor to show the analysis. */
  onType: (text: string, collapse: boolean) => void;
  onExample: () => void;
  onSite: (site: string) => void;
  onDone: () => void;
}

/** Where the visitor pastes their policy (and, optionally, their site's address). */
export function PolicyEditor({ input, parsed, hasPolicy, site, onType, onExample, onSite, onDone }: EditorProps) {
  const t = useT();
  return (
    <>
      <h1 id="input-title">
        <label for="policy-input">{t('analyzer.inputLabel')}</label>
      </h1>
      {!hasPolicy && <p class="promise">{t('analyzer.whatYouGet')}</p>}
      <textarea
        id="policy-input"
        class="code"
        rows={hasPolicy ? 4 : 5}
        spellcheck={false}
        autocomplete="off"
        placeholder={t('analyzer.placeholder')}
        value={input}
        onInput={(e) => onType(e.currentTarget.value, false)}
        onPaste={(e) => {
          // A paste is a complete policy: show the analysis right away.
          const text = e.clipboardData?.getData('text') ?? '';
          if (text.trim() && !input.trim()) {
            e.preventDefault();
            onType(text, true);
          }
        }}
      />
      <p class="muted format-hint">{t('analyzer.inputHint')}</p>
      <div class="input-actions">
        {hasPolicy ? (
          <button type="button" class="button" onClick={onDone}>
            {t('analyzer.hideEditor')}
          </button>
        ) : (
          <button type="button" class="button quiet" onClick={() => {
              track('example');
              onExample();
            }}>
            {t('analyzer.example')}
          </button>
        )}
      </div>
      <details class="site-field">
        <summary>{t('analyzer.siteLabel')}</summary>
        <input type="text" inputMode="url" value={site} placeholder="www.example.com" onInput={(e) => onSite(e.currentTarget.value)} />
        <p class="muted">{t('analyzer.siteHint')}</p>
      </details>
      {!hasPolicy &&
        input.trim() !== '' &&
        (parsed.issues.some((i) => i.code === 'no-policy-found') ? (
          <p class="issue"><Rich msg="analyzer.noPolicyFound" /></p>
        ) : (
          <p class="issue">{emptyMessage(t, parsed.issues)}</p>
        ))}
    </>
  );
}

/** Before a policy is in: the other ways to start, for visitors who don't have one to paste. */
export function OtherStarts() {
  const t = useT();
  const starts = [
    { lead: t('analyzer.noPolicy'), key: 'find', href: '/find-my-csp' },
    { lead: t('analyzer.noPolicyYet'), key: 'build', href: '/build' },
    { lead: t('analyzer.newHere'), key: 'whatIs', href: '/learn' },
  ];
  return (
    <section class="other-starts" aria-labelledby="other-starts-title">
      <h2 id="other-starts-title">{t('analyzer.otherStarts')}</h2>
      <ul>
        {starts.map((s) => (
          <li key={s.key}>
            <p class="muted">{s.lead}</p>
            <a href={localePath(t.locale, s.href)}>{t(`site.nav.${s.key}`)}</a>
            <p>{t(`site.nav.desc.${s.key}`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SummaryProps {
  parsed: ParseResult;
  /** The policy shown in the views. */
  policy: Policy | undefined;
  onEdit: () => void;
  onClear: () => void;
  /** The builder, opened on this policy and its tools. */
  buildHref: string;
}

/** The folded editor: what was found, and the actions on it. */
export function PolicySummary({ parsed, policy, onEdit, onClear, buildHref }: SummaryProps) {
  const t = useT();
  const { copied: shared, copy } = useCopy();
  const ruleCount = parsed.policies.reduce((n, p) => n + p.directives.length, 0);
  return (
    <>
      <h1 id="input-title">{t('analyzer.yourPolicy')}</h1>
      <div class="summary-bar">
        <p class="summary">
          {parsed.policies.length > 1 ? (
            <span class="badge">{t('analyzer.policiesShort', { count: parsed.policies.length })}</span>
          ) : (
            <span class={policy?.reportOnly ? 'badge badge-report' : 'badge'}>
              {policy?.reportOnly ? t('analyzer.reportOnly') : t('analyzer.enforced')}
            </span>
          )}
          <span>{t('analyzer.rules', { count: ruleCount })}</span>
          {policy?.origin === 'header' && <span class="muted">{t('analyzer.fromHeader')}</span>}
          {policy?.origin === 'meta' && <span class="muted">{t('analyzer.fromMeta')}</span>}
        </p>
        <div class="summary-actions">
          <button type="button" class="button quiet" onClick={onEdit}>
            {t('analyzer.edit')}
          </button>
          <button type="button" class="button quiet" onClick={() => copy(location.href)} title={t('analyzer.shareHint')}>
            {shared ? t('analyzer.shared') : t('analyzer.share')}
          </button>
          <a class="button quiet" href={buildHref}>
            {t('analyzer.build')}
          </a>
          <button type="button" class="button quiet" onClick={onClear}>
            {t('analyzer.clear')}
          </button>
        </div>
      </div>
    </>
  );
}
