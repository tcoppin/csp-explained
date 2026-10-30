import { useState } from 'preact/hooks';
import { SITE_URL } from '../config';
import { LOCALE_NAMES, LOCALES, localePath, translator, type Locale, type Translate } from '../i18n';
import { patchedPolicies, type Analysis } from '../lib/analysis';
import type { Vendor } from '../lib/catalogue/schema';
import type { Audience } from '../lib/csp/model';
import { deploySnippet, developerReport, headersBesideMeta, policyDiff, TARGETS, type Target } from '../lib/reports/developer';
import { countByLevel, findingText, securityReport } from '../lib/reports/security';
import { itRequest, withVendorText, type MessageFormat } from '../lib/reports/simple';
import { track } from '../scripts/track';
import { CodeBox } from './CodeBox';
import { Segmented } from './Segmented';
import { useT } from './i18n';
import { useCopy } from './useCopy';

type ReportPart = 'message' | 'diff' | 'deploy' | 'markdown';

function CopyButton({ text, label, onCopy }: { text: string; label?: string; onCopy?: () => void }) {
  const t = useT();
  const { copied, copy } = useCopy(onCopy);
  return (
    <button type="button" class="button" onClick={() => copy(text)}>
      {copied ? t('report.copied') : (label ?? t('report.copy'))}
    </button>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const FORMATS: MessageFormat[] = ['email', 'chat', 'ticket'];

const labelled = <T extends string>(t: Translate, ids: readonly T[], prefix: string) => ids.map((id) => ({ id, label: t(`${prefix}.${id}`) }));

interface Props {
  analysis: Analysis;
  audience: Audience;
  site: string;
  /** Each language's tool texts, so the IT message can be written in another language than the page's. */
  vendorsIn: Partial<Record<Locale, Vendor[]>>;
  onPickTools: () => void;
}

export function ReportPanel({ analysis, audience, site, vendorsIn, onPickTools }: Props) {
  const t = useT();
  const [format, setFormat] = useState<MessageFormat>('email');
  // A French marketer may write to an English-speaking IT team: the message has its own language.
  const [messageLocale, setMessageLocale] = useState<Locale>(t.locale);
  const [target, setTarget] = useState<Target>('nginx');
  const copied = (kind: ReportPart) => () => track('copy-report', { audience, kind });

  const noTools = (
    <div class="empty">
      <p>{t('report.nothing')}</p>
      <button type="button" class="button" onClick={onPickTools}>
        {t('report.pickTools')}
      </button>
    </div>
  );

  if (audience === 'simple') {
    if (analysis.vendors.length === 0) return noTools;
    const mt = messageLocale === t.locale ? t : translator(messageLocale);
    const text = itRequest(withVendorText(analysis, vendorsIn[messageLocale] ?? []), mt, {
      format,
      site,
      toolUrl: new URL(localePath(messageLocale, '/'), SITE_URL).href,
    });
    return (
      <div class="report">
        <div class="report-options">
          <Segmented class="tabs" items={labelled(t, FORMATS, 'report.formats')} value={format} onChange={setFormat} label={t('report.title')} />
          <Segmented
            class="tabs"
            items={LOCALES.map((id) => ({ id, label: LOCALE_NAMES[id], lang: id }))}
            value={messageLocale}
            onChange={setMessageLocale}
            label={t('report.languageLabel')}
          />
        </div>
        <textarea class="code message" readOnly rows={Math.min(28, text.split('\n').length + 1)} value={text} aria-label={t('report.title')} />
        <div class="actions">
          <CopyButton text={text} onCopy={copied('message')} />
        </div>
      </div>
    );
  }

  if (audience === 'developer') {
    if (analysis.vendors.length === 0) return noTools;
    const markdown = developerReport(analysis, t);
    const snippet = deploySnippet(analysis, target);
    const metaHeaders = target === 'meta' ? headersBesideMeta(analysis) : '';
    return (
      <div class="report">
        {analysis.patches.length === 0 ? (
          <p>{t('report.developer.noChange')}</p>
        ) : (
          <>
            <h3>{t('report.developer.diff')}</h3>
            <CodeBox caption={t('report.developer.diffCaption')} copyText={patchedPolicies(analysis).map((p) => p.text).join('\n')} class="diff" onCopy={copied('diff')}>
              {policyDiff(analysis)
                .split('\n')
                .map((l, i) => (
                  <span key={i} class={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>
                    {l}
                    {'\n'}
                  </span>
                ))}
            </CodeBox>
            <h3>{t('report.developer.deploy')}</h3>
            <Segmented class="tabs" items={labelled(t, TARGETS, 'report.developer.targets')} value={target} onChange={setTarget} label={t('report.developer.deploy')} />
            {snippet && <CodeBox caption={t(`report.developer.targetCaptions.${target}`)} copyText={snippet} onCopy={copied('deploy')} />}
            {metaHeaders && <CodeBox caption={t('report.developer.metaHeaders')} copyText={metaHeaders} onCopy={copied('deploy')} />}
          </>
        )}
        {analysis.vendors.some((v) => v.verdict === 'needs-nonce') && (
          <>
            <h3>{t('report.developer.needsNonce')}</h3>
            <ul>
              {analysis.vendors
                .filter((v) => v.verdict === 'needs-nonce')
                .map((v) => (
                  <li key={v.vendor.id}>
                    <strong>{v.vendor.name}</strong>: {v.vendor.nonce?.how ?? t('report.needsNonceNoHow')}
                  </li>
                ))}
            </ul>
          </>
        )}
        <p class="muted">{t('report.developer.verify')}</p>
        <div class="actions">
          <CopyButton text={markdown} label={t('report.copyMarkdown')} onCopy={copied('markdown')} />
          <button type="button" class="button quiet" onClick={() => download('csp-change.md', markdown)}>
            {t('report.download')}
          </button>
        </div>
      </div>
    );
  }

  const markdown = securityReport(analysis, t);
  const counts = countByLevel(analysis.findings);
  const findingList = (findings: Analysis['findings']) => (
    <ul class="findings">
      {findings.map((f, i) => (
        <li key={i} class={`finding level-${f.level}`}>
          <span class="level">
            {t(`report.security.level.${f.level}`)}
            {f.maybe && ` (${t('report.security.maybe')})`}
          </span>
          <code>{[f.directive, f.value].filter(Boolean).join(' ')}</code>
          {analysis.parsed.policies.length > 1 && <span class="muted"> · {t('analyzer.policy', { index: f.policyIndex + 1 })}</span>}
          <span class="desc">{findingText(t, f)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div class="report">
      <p class="lead">{t('report.security.summary', counts)}</p>
      {analysis.parsed.policies.filter((p) => !p.reportOnly).length > 1 && <p class="muted">{t('report.security.multiplePolicies')}</p>}
      {analysis.vendors.length > 0 && (
        <>
          <h3>{t('report.security.introduced')}</h3>
          {analysis.introducedFindings.length === 0 ? <p>{t('report.security.noneIntroduced')}</p> : findingList(analysis.introducedFindings)}
        </>
      )}
      <h3>{t('report.security.current')}</h3>
      {analysis.findings.length === 0 ? <p>{t('report.security.noFindings')}</p> : findingList(analysis.findings)}
      <p class="muted">{t('report.security.attribution')}</p>
      <div class="actions">
        <CopyButton text={markdown} label={t('report.copyMarkdown')} onCopy={copied('markdown')} />
        <button type="button" class="button quiet" onClick={() => download('csp-security-review.md', markdown)}>
          {t('report.download')}
        </button>
      </div>
    </div>
  );
}
