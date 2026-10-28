import { useState } from 'preact/hooks';
import { SITE_URL } from '../config';
import { t } from '../i18n';
import { patchedPolicies, type Analysis } from '../lib/analysis';
import type { Audience } from '../lib/csp/model';
import { deploySnippet, developerReport, policyDiff, TARGETS, type Target } from '../lib/reports/developer';
import { countByLevel, securityReport } from '../lib/reports/security';
import { itRequest, type MessageFormat } from '../lib/reports/simple';
import { CodeBox } from './CodeBox';

function CopyButton({ text, label = t('report.copy') }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      // Clipboard can be blocked; the text stays selectable.
    }
  };
  return (
    <button type="button" class="button" onClick={copy}>
      {done ? t('report.copied') : label}
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

function Tabs<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div class="tabs" role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button key={i.id} type="button" role="radio" aria-checked={value === i.id} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

const FORMATS: { id: MessageFormat; label: string }[] = [
  { id: 'email', label: t('report.formats.email') },
  { id: 'chat', label: t('report.formats.chat') },
  { id: 'ticket', label: t('report.formats.ticket') },
];

interface Props {
  analysis: Analysis;
  audience: Audience;
  site: string;
  onPickTools: () => void;
}

export function ReportPanel({ analysis, audience, site, onPickTools }: Props) {
  const [format, setFormat] = useState<MessageFormat>('email');
  const [target, setTarget] = useState<Target>('nginx');

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
    const text = itRequest(analysis, t, { format, site, toolUrl: SITE_URL });
    return (
      <div class="report">
        <Tabs items={FORMATS} value={format} onChange={setFormat} label={t('report.title')} />
        <textarea class="code message" readOnly rows={Math.min(28, text.split('\n').length + 1)} value={text} aria-label={t('report.title')} />
        <div class="actions">
          <CopyButton text={text} />
        </div>
      </div>
    );
  }

  if (audience === 'developer') {
    if (analysis.vendors.length === 0) return noTools;
    const markdown = developerReport(analysis, t);
    const snippet = deploySnippet(analysis, target);
    return (
      <div class="report">
        {analysis.patches.length === 0 ? (
          <p>{t('report.developer.noChange')}</p>
        ) : (
          <>
            <h3>{t('report.developer.diff')}</h3>
            <CodeBox caption={t('report.developer.diffCaption')} copyText={patchedPolicies(analysis).map((p) => p.text).join('\n')} class="diff">
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
            <Tabs items={TARGETS} value={target} onChange={setTarget} label={t('report.developer.deploy')} />
            <CodeBox caption={TARGETS.find((x) => x.id === target)?.caption ?? ''} copyText={snippet} />
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
                    <strong>{v.vendor.name}</strong>: {v.vendor.nonce?.how}
                  </li>
                ))}
            </ul>
          </>
        )}
        <p class="muted">{t('report.developer.verify')}</p>
        <div class="actions">
          <CopyButton text={markdown} label={`${t('report.copy')} Markdown`} />
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
          <span class="desc">{f.description}</span>
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
        <CopyButton text={markdown} label={`${t('report.copy')} Markdown`} />
        <button type="button" class="button quiet" onClick={() => download('csp-security-review.md', markdown)}>
          {t('report.download')}
        </button>
      </div>
    </div>
  );
}
