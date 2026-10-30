import type { Translate } from '../../i18n';
import { patchedPolicies, type Analysis } from '../analysis';
import { directiveInfo } from '../csp/directives';
import { parseSinglePolicy } from '../csp/parser';

/** Where a developer can deploy the policy, in display order. Labels and captions: `report.developer.targets.*`. */
export const TARGETS = ['nginx', 'apache', 'cloudfront', 'netlify', 'vercel', 'express', 'meta'] as const;
export type Target = (typeof TARGETS)[number];

const headerName = (reportOnly: boolean) => (reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy');

/** The policy as a double-quoted nginx or Apache string: whatever was pasted can't end the string early. */
const quoted = (text: string) => `"${text.replace(/["\\]/g, '\\$&')}"`;

/** Directive-per-line diff of every changed policy. */
export function policyDiff(a: Analysis): string {
  return a.patches
    .map((patch) => {
      const lines: string[] = [];
      if (a.parsed.policies.length > 1) lines.push(`# policy ${patch.policyIndex + 1}`);
      for (const c of patch.changes) {
        if (c.before) lines.push(`- ${c.before}`);
        lines.push(`+ ${c.after}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Splits an enforced policy into what a <meta> tag can carry and the directives browsers ignore there. */
function splitForMeta(policy: string): { meta: string; headerOnly: string } {
  const directives = parseSinglePolicy(policy, 'meta').directives;
  const text = (ignored: boolean) =>
    directives
      .filter((d) => Boolean(directiveInfo(d.name)?.ignoredInMeta) === ignored)
      .map((d) => policy.slice(d.span.start, d.span.end))
      .join('; ');
  return { meta: text(false), headerOnly: text(true) };
}

/**
 * What a <meta> tag can't carry, as HTTP headers to send next to it: report-only policies, and the directives
 * browsers ignore in <meta> (frame-ancestors, sandbox, report-uri, report-to). Empty when there is none.
 */
export function headersBesideMeta(a: Analysis): string {
  return patchedPolicies(a)
    .flatMap((p) => {
      if (p.reportOnly) return [`${headerName(true)}: ${p.text}`];
      const { headerOnly } = splitForMeta(p.text);
      return headerOnly ? [`${headerName(false)}: ${headerOnly}`] : [];
    })
    .join('\n');
}

function helmetDirectives(policy: string): string {
  const entries = policy
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map(([name, ...values]) => {
      const key = name!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return `      ${key}: [${values.map((v) => JSON.stringify(v)).join(', ')}],`;
    });
  return entries.join('\n');
}

/** Configuration snippet setting the (patched) policies on a given server or platform. */
export function deploySnippet(a: Analysis, target: Target): string {
  const policies = patchedPolicies(a);
  switch (target) {
    case 'nginx':
      return policies.map((p) => `add_header ${headerName(p.reportOnly)} ${quoted(p.text)} always;`).join('\n');
    case 'apache':
      return policies.map((p) => `Header always set ${headerName(p.reportOnly)} ${quoted(p.text)}`).join('\n');
    case 'cloudfront': {
      // Response headers policy (CloudFormation / CDK). Only one CSP header can be set this way.
      const enforced = policies.find((p) => !p.reportOnly) ?? policies[0];
      return [
        'ResponseHeadersPolicyConfig:',
        '  SecurityHeadersConfig:',
        '    ContentSecurityPolicy:',
        // A JSON string is a valid double-quoted YAML string.
        `      ContentSecurityPolicy: ${JSON.stringify(enforced?.text ?? '')}`,
        '      Override: true',
      ].join('\n');
    }
    case 'netlify':
      return ['/*', ...policies.map((p) => `  ${headerName(p.reportOnly)}: ${p.text}`)].join('\n');
    case 'vercel':
      return JSON.stringify(
        { headers: [{ source: '/(.*)', headers: policies.map((p) => ({ key: headerName(p.reportOnly), value: p.text })) }] },
        null,
        2,
      );
    case 'express':
      return policies
        .map((p) =>
          [
            'app.use(',
            '  helmet.contentSecurityPolicy({',
            '    useDefaults: false,',
            ...(p.reportOnly ? ['    reportOnly: true,'] : []),
            '    directives: {',
            helmetDirectives(p.text),
            '    },',
            '  }),',
            ');',
          ].join('\n'),
        )
        .join('\n\n');
    case 'meta':
      // What a <meta> tag can't carry is in headersBesideMeta().
      return policies
        .filter((p) => !p.reportOnly)
        .map((p) => splitForMeta(p.text).meta)
        .filter((text) => text !== '')
        .map((text) => `<meta http-equiv="Content-Security-Policy" content="${text.replace(/"/g, '&quot;')}">`)
        .join('\n');
  }
}

/** Markdown summary for developers: diff, full policies, nonce notes. */
export function developerReport(a: Analysis, t: Translate): string {
  const out: string[] = [`## ${t('report.developer.title')}`, ''];
  if (a.patches.length === 0) out.push(t('report.developer.noChange'));
  else {
    out.push(`### ${t('report.developer.diff')}`, '', '```diff', policyDiff(a), '```', '');
    out.push(`### ${t('report.developer.full')}`, '');
    for (const p of patchedPolicies(a)) out.push('```', `${headerName(p.reportOnly)}: ${p.text}`, '```', '');
  }
  const nonce = a.vendors.filter((v) => v.verdict === 'needs-nonce');
  if (nonce.length > 0) {
    out.push('', `### ${t('report.developer.needsNonce')}`, '');
    for (const v of nonce) out.push(`- **${v.vendor.name}**: ${v.vendor.nonce?.how ?? t('report.needsNonceNoHow')} (${v.vendor.sources[0]})`);
  }
  out.push('', `> ${t('report.developer.verify')}`);
  return out.join('\n');
}
