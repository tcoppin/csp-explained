import type { Translate } from '../../i18n';
import { patchedPolicies, type Analysis } from '../analysis';

export type Target = 'nginx' | 'apache' | 'cloudfront' | 'netlify' | 'vercel' | 'express' | 'meta';

export const TARGETS: { id: Target; label: string; caption: string }[] = [
  { id: 'nginx', label: 'nginx', caption: 'Add to your nginx server block' },
  { id: 'apache', label: 'Apache', caption: 'Add to your Apache config or .htaccess' },
  { id: 'cloudfront', label: 'AWS CloudFront', caption: 'Response headers policy (CloudFormation)' },
  { id: 'netlify', label: 'Netlify', caption: 'Add to your _headers file' },
  { id: 'vercel', label: 'Vercel', caption: 'Add to vercel.json' },
  { id: 'express', label: 'Express (helmet)', caption: 'Add to your Express app' },
  { id: 'meta', label: '<meta> tag', caption: 'Add to the <head> of every page' },
];

const headerName = (reportOnly: boolean) => (reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy');

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
      return policies.map((p) => `add_header ${headerName(p.reportOnly)} "${p.text}" always;`).join('\n');
    case 'apache':
      return policies.map((p) => `Header always set ${headerName(p.reportOnly)} "${p.text}"`).join('\n');
    case 'cloudfront': {
      // Response headers policy (CloudFormation / CDK). Only one CSP header can be set this way.
      const enforced = policies.find((p) => !p.reportOnly) ?? policies[0];
      return [
        'ResponseHeadersPolicyConfig:',
        '  SecurityHeadersConfig:',
        '    ContentSecurityPolicy:',
        `      ContentSecurityPolicy: "${enforced?.text ?? ''}"`,
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
      return policies
        .filter((p) => !p.reportOnly)
        .map((p) => `<meta http-equiv="Content-Security-Policy" content="${p.text.replace(/"/g, '&quot;')}">`)
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
    for (const v of nonce) out.push(`- **${v.vendor.name}**: ${v.vendor.nonce?.how ?? ''} (${v.vendor.sources[0]})`);
  }
  out.push('', `> ${t('report.developer.verify')}`);
  return out.join('\n');
}
