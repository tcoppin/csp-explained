import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { SITE_URL } from '../../config';
import { LOCALE_NAMES, LOCALES, localePath, translator, type Locale, type Translate } from '../../i18n';
import { patchedPolicies, type Analysis } from '../../lib/analysis';
import type { Vendor } from '../../lib/catalogue/schema';
import type { DirectiveDoc } from '../../lib/content';
import type { Audience } from '../../lib/csp/model';
import { deploySnippet, developerReport, headersBesideMeta, metaBesideHeaders, policyDiff, reportOnlyNote, TARGETS, type Target } from '../../lib/reports/developer';
import { exportFileName, printTitle, type ExportFormat, type ExportOptions } from '../../lib/reports/export';
import { securityReport, summaryLine, toolNote } from '../../lib/reports/security';
import { itRequest, withVendorText, type MessageFormat } from '../../lib/reports/simple';
import { track } from '../../scripts/track';
import { FindingList } from '../policy/FindingList';
import { CodeBox } from '../ui/CodeBox';
import { Rich } from '../ui/Rich';
import { Segmented } from '../ui/Segmented';
import { useT } from '../ui/i18n';
import { useCopy } from '../ui/useCopy';
import { downloadFile } from '../ui/document';
import { documentTitle, printDocument, reportFile, ReportDocument } from './ReportDocument';
import { useVendorTexts } from './vendor-texts';

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

const TYPES: Record<Exclude<ExportFormat, 'pdf'>, string> = { md: 'text/markdown', txt: 'text/plain', html: 'text/html' };

const download = (name: string, text: string, format: Exclude<ExportFormat, 'pdf'>) => downloadFile(name, text, TYPES[format]);

/**
 * Saving the report: printed or saved as PDF, or downloaded as a file. The choices of what to include apply to the PDF
 * and the .html file, which are the same document; the text file is the report as copied.
 */
interface SaveProps {
  audience: Audience;
  site: string;
  options: ExportOptions;
  setOptions: (o: ExportOptions) => void;
  doc: (options: ExportOptions) => VNode;
  text: { format: 'md' | 'txt'; content: string };
}

function SaveCopy({ audience, site, options, setOptions, doc, text }: SaveProps) {
  const t = useT();
  const title = documentTitle(t, audience);
  const saved = (format: ExportFormat) => track('export-report', { audience, format });
  const option = (key: keyof ExportOptions) => (
    <label>
      <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.currentTarget.checked })} />{' '}
      {t(`report.export.include.${key}`)}
    </label>
  );
  return (
    <fieldset class="save-copy">
      <legend>{t('report.export.title')}</legend>
      <div class="save-options">
        {option('policy')}
        {option('rules')}
      </div>
      <div class="actions">
        <button
          type="button"
          class="button"
          onClick={() => {
            saved('pdf');
            printDocument(doc(options), printTitle(title, site));
          }}
        >
          {t('report.export.print')}
        </button>
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            saved('html');
            download(exportFileName(audience, 'html'), reportFile(doc(options), title, t.locale), 'html');
          }}
        >
          {t('report.export.html')}
        </button>
        <button
          type="button"
          class="button quiet"
          onClick={() => {
            saved(text.format);
            download(exportFileName(audience, text.format), text.content, text.format);
          }}
        >
          {t(`report.export.${text.format}`)}
        </button>
      </div>
      <p class="muted format-hint">{t('report.export.hint')}</p>
    </fieldset>
  );
}

const FORMATS: MessageFormat[] = ['email', 'chat', 'ticket'];

const labelled = <T extends string>(t: Translate, ids: readonly T[], prefix: string) => ids.map((id) => ({ id, label: t(`${prefix}.${id}`) }));

interface Props {
  analysis: Analysis;
  audience: Audience;
  site: string;
  /** The tools' texts in the page's language; another language's are fetched when the IT message is written in it. */
  vendors: Vendor[];
  /** What each rule means, for the printed report when the visitor asks for it. */
  directives: Record<string, DirectiveDoc>;
  /** What the PDF and .html file include: kept by the analyzer, so they last from one report and view to the next. */
  exportOptions: ExportOptions;
  onExportOptions: (o: ExportOptions) => void;
  onPickTools: () => void;
  /** Opens the hashes offer for the 'unsafe-inline' a finding is about. */
  onHashes: (policyIndex: number, directive: string) => void;
}

export function ReportPanel({ analysis, audience, site, vendors, directives, exportOptions, onExportOptions, onPickTools, onHashes }: Props) {
  const t = useT();
  const [format, setFormat] = useState<MessageFormat>('email');
  // A French marketer may write to an English-speaking IT team: the message has its own language.
  const [messageLocale, setMessageLocale] = useState<Locale>(t.locale);
  const texts = useVendorTexts(messageLocale, t.locale, vendors);
  const [target, setTarget] = useState<Target>('nginx');
  const copied = (kind: ReportPart) => () => track('copy-report', { audience, kind });
  /** The report as a document, built when it's saved: the link is this analysis as the address bar has it then. */
  const doc = (message?: { text: string; locale: Locale }) => (options: ExportOptions) => (
    <ReportDocument t={t} analysis={analysis} audience={audience} site={site} options={options} directives={directives} message={message} target={target} link={location.href} date={new Date()} />
  );

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
    // Until another language's tool texts arrive, no message: half of it would be in the page's language.
    // If they can't be loaded, the message keeps the tools' texts in the page's language, and says so.
    const text =
      texts.state === 'loading'
        ? ''
        : itRequest(withVendorText(analysis, texts.state === 'ready' ? texts.vendors : vendors), mt, {
            format,
            site,
            toolUrl: new URL(localePath(messageLocale, '/'), SITE_URL).href,
          });
    const language = LOCALE_NAMES[messageLocale];
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
        <p class="muted message-language-note" role="status">
          {texts.state === 'loading' ? t('report.languageLoading', { language }) : texts.state === 'failed' ? t('report.languageFailed', { language }) : ''}
        </p>
        {texts.state !== 'loading' && (
          <>
            <textarea class="code message" readOnly rows={Math.min(28, text.split('\n').length + 1)} value={text} aria-label={t('report.title')} />
            <div class="actions">
              <CopyButton text={text} onCopy={copied('message')} />
            </div>
            <SaveCopy audience={audience} site={site} options={exportOptions} setOptions={onExportOptions} doc={doc({ text, locale: messageLocale })} text={{ format: 'txt', content: text }} />
          </>
        )}
      </div>
    );
  }

  if (audience === 'developer') {
    if (analysis.vendors.length === 0) return noTools;
    const markdown = developerReport(analysis, t);
    const snippet = deploySnippet(analysis, target);
    const metaHeaders = target === 'meta' ? headersBesideMeta(analysis) : '';
    const keptMeta = metaBesideHeaders(analysis, target);
    const reportOnly = reportOnlyNote(analysis, t);
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
            {reportOnly && <p>{reportOnly}</p>}
            <h3>{t('report.developer.deploy')}</h3>
            <Segmented class="tabs" items={labelled(t, TARGETS, 'report.developer.targets')} value={target} onChange={setTarget} label={t('report.developer.deploy')} />
            {snippet && <CodeBox caption={t(`report.developer.targetCaptions.${target}`)} copyText={snippet} onCopy={copied('deploy')} />}
            {metaHeaders && <CodeBox caption={t('report.developer.metaHeaders')} copyText={metaHeaders} onCopy={copied('deploy')} />}
            {keptMeta.tags && (
              <CodeBox caption={t('report.developer.metaKept', { count: keptMeta.count })} copyText={keptMeta.tags} onCopy={copied('deploy')} />
            )}
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
        </div>
        <SaveCopy audience={audience} site={site} options={exportOptions} setOptions={onExportOptions} doc={doc()} text={{ format: 'md', content: markdown }} />
      </div>
    );
  }

  const markdown = securityReport(analysis, t);
  const findingList = (findings: Analysis['findings']) => (
    <FindingList
      findings={findings}
      tag={(f) => (analysis.parsed.policies.length > 1 ? t('analyzer.policy', { index: f.policyIndex + 1 }) : undefined)}
      action={(f) => {
        const note = toolNote(t, f, analysis);
        return (
          <>
            {note}
            {f.id === 'script-unsafe-inline' && (
              <>
                {note && ' '}
                <button type="button" class="link-button" onClick={() => onHashes(f.policyIndex, f.directive)}>
                  {t('hashes.fix.fromFinding')}
                </button>{' '}
                <Rich msg="hashes.fix.orNonces" />
              </>
            )}
          </>
        );
      }}
    />
  );

  return (
    <div class="report">
      <p class="lead">{summaryLine(t, analysis.findings)}</p>
      {analysis.parsed.policies.filter((p) => !p.reportOnly).length > 1 && <p class="muted">{t('report.security.multiplePolicies')}</p>}
      <h3>{t('report.security.current')}</h3>
      {analysis.findings.length === 0 ? <p>{t('report.security.noFindings')}</p> : findingList(analysis.findings)}
      {analysis.vendors.length > 0 && (
        <>
          <h3>{t('report.security.introduced')}</h3>
          {analysis.introducedFindings.length === 0 ? <p>{t('report.security.noneIntroduced')}</p> : findingList(analysis.introducedFindings)}
        </>
      )}
      <p class="muted">{t('report.security.attribution')}</p>
      <div class="actions">
        <CopyButton text={markdown} label={t('report.copyMarkdown')} onCopy={copied('markdown')} />
      </div>
      <SaveCopy audience={audience} site={site} options={exportOptions} setOptions={onExportOptions} doc={doc()} text={{ format: 'md', content: markdown }} />
    </div>
  );
}
