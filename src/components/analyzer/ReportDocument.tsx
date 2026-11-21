import type { VNode } from 'preact';
import { SITE_URL } from '../../config';
import { localePath, type Locale, type Translate } from '../../i18n';
import { patchedPolicies, type Analysis } from '../../lib/analysis';
import type { DirectiveDoc } from '../../lib/content';
import type { Audience } from '../../lib/csp/model';
import type { SecurityFinding } from '../../lib/csp/security';
import { deploySnippet, headerName, headersBesideMeta, metaBesideHeaders, policyDiff, reportOnlyNote, type Target } from '../../lib/reports/developer';
import type { ExportOptions } from '../../lib/reports/export';
import { findingText, summaryLine, toolNote } from '../../lib/reports/security';
import { documentFile, printDocument } from '../ui/document';
// Applied to the page for printing, and written into the .html file as text (the paper itself: ui/document.css).
import './report-document.css';
import css from './report-document.css?raw';

export { printDocument };

export interface ReportDocumentProps {
  t: Translate;
  analysis: Analysis;
  audience: Audience;
  /** The site as the visitor typed it. */
  site: string;
  options: ExportOptions;
  directives: Record<string, DirectiveDoc>;
  /** The IT message as shown, in the language picked for it (Everyone). */
  message?: { text: string; locale: Locale };
  /** Where the developer chose to set the policy. */
  target: Target;
  /** This analysis, as a link to open again. */
  link: string;
  date: Date;
}

/** Where a policy comes from, in words that need no translation. */
const place = (p: { origin: string; reportOnly: boolean }) => (p.origin === 'meta' ? '<meta> tag' : headerName(p.reportOnly));

export const documentTitle = (t: Translate, audience: Audience) => t(`report.document.title.${audience}`);

function Code({ caption, text }: { caption: string; text: string }) {
  return (
    <figure class="doc-code">
      <figcaption>{caption}</figcaption>
      <pre>{text}</pre>
    </figure>
  );
}

function Findings({ t, findings, analysis }: { t: Translate; findings: SecurityFinding[]; analysis: Analysis }) {
  const multiple = analysis.parsed.policies.length > 1;
  return (
    <ul class="doc-findings">
      {findings.map((f, i) => {
        const note = toolNote(t, f, analysis);
        return (
          <li key={i} class={`level-${f.level}`}>
            <strong class="doc-level">
              {t(`report.security.level.${f.level}`)}
              {f.maybe && ` (${t('report.security.maybe')})`}
            </strong>{' '}
            <code>{[f.directive, f.value].filter(Boolean).join(' ')}</code>
            {multiple && <span class="doc-tag"> {t('analyzer.policy', { index: f.policyIndex + 1 })}</span>}
            <br />
            {findingText(t, f)}
            {note && ` ${note}`}
          </li>
        );
      })}
    </ul>
  );
}

function SimpleBody({ message }: { message: NonNullable<ReportDocumentProps['message']> }) {
  return (
    <section class="doc-message" lang={message.locale}>
      {message.text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </section>
  );
}

function DeveloperBody({ t, analysis, target }: Pick<ReportDocumentProps, 't' | 'analysis' | 'target'>) {
  const nonce = analysis.vendors.filter((v) => v.verdict === 'needs-nonce');
  const snippet = deploySnippet(analysis, target);
  const metaHeaders = target === 'meta' ? headersBesideMeta(analysis) : '';
  const keptMeta = metaBesideHeaders(analysis, target);
  const reportOnly = reportOnlyNote(analysis, t);
  return (
    <>
      {analysis.patches.length === 0 ? (
        <p>{t('report.developer.noChange')}</p>
      ) : (
        <>
          <h2>{t('report.developer.diff')}</h2>
          <figure class="doc-code">
            <figcaption>{t('report.document.diffCaption')}</figcaption>
            <pre class="doc-diff">
              {policyDiff(analysis)
                .split('\n')
                .map((l, i) => (
                  <span key={i} class={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : undefined}>
                    {l}
                    {'\n'}
                  </span>
                ))}
            </pre>
          </figure>
          {reportOnly && <p>{reportOnly}</p>}
          <h2>{t('report.developer.full')}</h2>
          {patchedPolicies(analysis).map((p, i) => (
            <Code key={i} caption={headerName(p.reportOnly)} text={p.text} />
          ))}
          <h2>{t('report.developer.deploy')}</h2>
          {snippet && <Code caption={`${t(`report.developer.targets.${target}`)}: ${t(`report.developer.targetCaptions.${target}`)}`} text={snippet} />}
          {metaHeaders && <Code caption={t('report.developer.metaHeaders')} text={metaHeaders} />}
          {keptMeta.tags && <Code caption={t('report.developer.metaKept', { count: keptMeta.count })} text={keptMeta.tags} />}
        </>
      )}
      {nonce.length > 0 && (
        <>
          <h2>{t('report.developer.needsNonce')}</h2>
          <ul>
            {nonce.map((v) => (
              <li key={v.vendor.id}>
                <strong>{v.vendor.name}</strong>: {v.vendor.nonce?.how ?? t('report.needsNonceNoHow')}{' '}
                <a href={v.vendor.sources[0]}>{v.vendor.sources[0]}</a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="doc-note">{t('report.developer.verify')}</p>
    </>
  );
}

function SecurityBody({ t, analysis }: Pick<ReportDocumentProps, 't' | 'analysis'>) {
  const strict = analysis.parsed.policies.some((p) => p.directives.some((d) => d.values.some((v) => v.kind === 'keyword' && v.value === "'strict-dynamic'")));
  return (
    <>
      <p class="doc-lead">{summaryLine(t, analysis.findings)}</p>
      {analysis.parsed.policies.filter((p) => !p.reportOnly).length > 1 && <p class="doc-note">{t('report.security.multiplePolicies')}</p>}
      <h2>{t('report.security.current')}</h2>
      {analysis.findings.length === 0 ? <p>{t('report.security.noFindings')}</p> : <Findings t={t} findings={analysis.findings} analysis={analysis} />}
      {analysis.vendors.length > 0 && (
        <>
          <h2>{t('report.security.introduced')}</h2>
          {analysis.introducedFindings.length === 0 ? (
            <p>{t('report.security.noneIntroduced')}</p>
          ) : (
            <Findings t={t} findings={analysis.introducedFindings} analysis={analysis} />
          )}
        </>
      )}
      {!strict && <p class="doc-note">{t('report.security.strictHint')}</p>}
      <p class="doc-note">{t('report.security.attribution')}</p>
    </>
  );
}

/** What each rule of the analysed policies means, once per rule, in the reader's voice. */
function Rules({ t, analysis, audience, directives }: Pick<ReportDocumentProps, 't' | 'analysis' | 'audience' | 'directives'>) {
  const names = [...new Set(analysis.parsed.policies.flatMap((p) => p.directives.map((d) => d.name)))].filter((n) => directives[n]);
  if (names.length === 0) return null;
  return (
    <section>
      <h2>{t('report.document.rules')}</h2>
      <dl class="doc-rules">
        {names.map((n) => (
          <div key={n}>
            <dt>
              <code>{n}</code> {directives[n]!.title}
            </dt>
            <dd>{directives[n]![audience]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A report as a document to print, save as PDF or keep as an .html file: always dark ink on white paper. */
export function ReportDocument(props: ReportDocumentProps) {
  const { t, analysis, audience, site, options, message, link, date } = props;
  const policies = analysis.parsed.policies;
  const home = new URL(localePath(t.locale, '/'), SITE_URL).href;
  return (
    <article class="report-doc" lang={t.locale}>
      <header>
        <p class="doc-brand">
          <a href={home}>{t('site.name')}</a>
        </p>
        <h1>{documentTitle(t, audience)}</h1>
        <dl class="doc-meta">
          {site.trim() && (
            <div>
              <dt>{t('report.document.site')}</dt>
              <dd>{site.trim()}</dd>
            </div>
          )}
          {analysis.vendors.length > 0 && (
            <div>
              <dt>{t('report.document.tools')}</dt>
              <dd>{new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(analysis.vendors.map((v) => v.vendor.name))}</dd>
            </div>
          )}
          <div>
            <dt>{t('report.document.date')}</dt>
            <dd>{new Intl.DateTimeFormat(t.locale, { dateStyle: 'long' }).format(date)}</dd>
          </div>
        </dl>
      </header>

      {options.policy && (
        <section>
          <h2>{t('report.document.policy', { count: policies.length })}</h2>
          {policies.map((p, i) => (
            <Code key={i} caption={place(p)} text={p.text} />
          ))}
        </section>
      )}

      <section class="doc-report">
        {audience === 'simple' && message && <SimpleBody message={message} />}
        {audience === 'developer' && <DeveloperBody {...props} />}
        {audience === 'security' && <SecurityBody {...props} />}
      </section>

      {options.rules && <Rules {...props} />}

      <footer>
        <p>
          {t('report.document.footer', { site: t('site.name') })} <a href={link}>{t('report.document.link')}</a>
        </p>
      </footer>
    </article>
  );
}

/** The report as a standalone .html file, its styles inside. */
export const reportFile = (doc: VNode, title: string, lang: string) => documentFile(doc, title, lang, css);
