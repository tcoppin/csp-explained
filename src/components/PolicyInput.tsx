import { localePath, type Translate } from '../i18n';
import type { ParseResult, Policy } from '../lib/csp/model';
import { track } from '../scripts/track';
import { useT } from './i18n';
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
      <p class="muted">{t('analyzer.inputHint')}</p>
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
        <p class="find-hint">
          {t('analyzer.noPolicy')} <a href={localePath(t.locale, '/find-my-csp')}>{t('analyzer.findLink')}</a>
        </p>
      </div>
      <details class="site-field">
        <summary>{t('analyzer.siteLabel')}</summary>
        <input type="text" inputMode="url" value={site} placeholder="www.example.com" onInput={(e) => onSite(e.currentTarget.value)} />
        <p class="muted">{t('analyzer.siteHint')}</p>
      </details>
      {!hasPolicy &&
        (input.trim() !== '' ? (
          <p class="issue">{emptyMessage(t, parsed.issues)}</p>
        ) : (
          <p class="what-you-get">{t('analyzer.whatYouGet')}</p>
        ))}
    </>
  );
}

interface SummaryProps {
  parsed: ParseResult;
  /** The policy shown in the views. */
  policy: Policy | undefined;
  onEdit: () => void;
  onClear: () => void;
}

/** The folded editor: what was found, and the actions on it. */
export function PolicySummary({ parsed, policy, onEdit, onClear }: SummaryProps) {
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
          <button type="button" class="button quiet" onClick={onClear}>
            {t('analyzer.clear')}
          </button>
        </div>
      </div>
    </>
  );
}
