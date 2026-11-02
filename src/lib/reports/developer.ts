import type { Translate } from '../../i18n';
import { patchedPolicies, type Analysis, type PatchedPolicy } from '../analysis';
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
      if (a.parsed.policies.length > 1) {
        // Where the policy is set, in words that need no translation: its header, or the <meta> tag.
        const p = a.parsed.policies[patch.policyIndex]!;
        const where = p.origin === 'meta' ? '<meta> tag' : headerName(p.reportOnly);
        lines.push(`# policy ${patch.policyIndex + 1}: ${where}`);
      }
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

/**
 * Policies set by a <meta> tag stay in the page when others come from the server: the server snippets leave
 * them out and `metaBesideHeaders` shows the updated tags. Otherwise every policy goes where the target says.
 */
const keepsMeta = (policies: PatchedPolicy[]) =>
  policies.some((p) => p.origin === 'meta') && policies.some((p) => p.origin !== 'meta');

/** What a server or platform sends: every policy, or those not set by a <meta> tag that stays. */
const serverPolicies = (a: Analysis) => {
  const policies = patchedPolicies(a);
  return keepsMeta(policies) ? policies.filter((p) => p.origin !== 'meta') : policies;
};

/** The <meta> tags for enforced policies, without the directives browsers ignore there. */
const metaTags = (policies: PatchedPolicy[]) =>
  policies
    .filter((p) => !p.reportOnly)
    .map((p) => splitForMeta(p.text).meta)
    .filter((text) => text !== '')
    .map((text) => `<meta http-equiv="Content-Security-Policy" content="${text.replace(/"/g, '&quot;')}">`)
    .join('\n');

/**
 * The <meta> tags to keep in the page next to a server snippet, when some policies come from <meta> and
 * others from the server. Empty otherwise.
 */
export function metaBesideHeaders(a: Analysis, target: Target): { tags: string; count: number } {
  const policies = patchedPolicies(a);
  if (target === 'meta' || !keepsMeta(policies)) return { tags: '', count: 0 };
  const kept = policies.filter((p) => p.origin === 'meta');
  return { tags: metaTags(kept), count: kept.length };
}

/**
 * One entry per header name, its policies in order. Several policies can share a header: browsers read
 * `Content-Security-Policy: a, b` as two policies, each enforced on its own.
 */
function byHeader(policies: PatchedPolicy[]): { name: string; texts: string[] }[] {
  const out: { name: string; texts: string[] }[] = [];
  for (const p of policies) {
    const name = headerName(p.reportOnly);
    const group = out.find((g) => g.name === name);
    if (group) group.texts.push(p.text);
    else out.push({ name, texts: [p.text] });
  }
  return out;
}

const joined = (texts: string[]) => texts.join(', ');

function expressSnippet(policies: PatchedPolicy[]): string {
  return byHeader(policies)
    .map(({ name, texts }) => {
      if (texts.length === 1) {
        return [
          'app.use(',
          '  helmet.contentSecurityPolicy({',
          '    useDefaults: false,',
          ...(name === headerName(true) ? ['    reportOnly: true,'] : []),
          '    directives: {',
          helmetDirectives(texts[0]!),
          '    },',
          '  }),',
          ');',
        ].join('\n');
      }
      // helmet sets one policy per header, and a second call would replace the first: an array sends each one.
      return [
        'app.use((req, res, next) => {',
        `  res.setHeader(${JSON.stringify(name)}, [`,
        ...texts.map((text) => `    ${JSON.stringify(text)},`),
        '  ]);',
        '  next();',
        '});',
      ].join('\n');
    })
    .join('\n\n');
}

/** Configuration snippet setting the (patched) policies on a given server or platform. */
export function deploySnippet(a: Analysis, target: Target): string {
  if (target === 'meta') return metaTags(patchedPolicies(a)); // What a <meta> tag can't carry: headersBesideMeta().
  const policies = serverPolicies(a);
  switch (target) {
    case 'nginx':
      // nginx sends each add_header, even with the same name.
      return policies.map((p) => `add_header ${headerName(p.reportOnly)} ${quoted(p.text)} always;`).join('\n');
    case 'apache': {
      // "set" replaces a header already set: the policies after the first one with the same name are added.
      const seen = new Set<string>();
      return policies
        .map((p) => {
          const name = headerName(p.reportOnly);
          const verb = seen.has(name) ? 'add' : 'set';
          seen.add(name);
          return `Header always ${verb} ${name} ${quoted(p.text)}`;
        })
        .join('\n');
    }
    case 'cloudfront': {
      // Response headers policy (CloudFormation / CDK). The security headers have one CSP, so the enforced
      // policies share it; the report-only header is a custom header.
      const groups = byHeader(policies);
      const enforced = groups.find((g) => g.name === headerName(false));
      const reportOnly = groups.find((g) => g.name === headerName(true));
      // A JSON string is a valid double-quoted YAML string.
      return [
        'ResponseHeadersPolicyConfig:',
        ...(enforced
          ? ['  SecurityHeadersConfig:', '    ContentSecurityPolicy:', `      ContentSecurityPolicy: ${JSON.stringify(joined(enforced.texts))}`, '      Override: true']
          : []),
        ...(reportOnly
          ? [
              '  CustomHeadersConfig:',
              '    Items:',
              `      - Header: ${reportOnly.name}`,
              `        Value: ${JSON.stringify(joined(reportOnly.texts))}`,
              '        Override: true',
            ]
          : []),
      ].join('\n');
    }
    case 'netlify':
      return ['/*', ...byHeader(policies).map((g) => `  ${g.name}: ${joined(g.texts)}`)].join('\n');
    case 'vercel':
      return JSON.stringify(
        { headers: [{ source: '/(.*)', headers: byHeader(policies).map((g) => ({ key: g.name, value: joined(g.texts) })) }] },
        null,
        2,
      );
    case 'express':
      return expressSnippet(policies);
  }
}

/**
 * Tools a report-only policy would report, when the proposed change updates a report-only policy:
 * the diff touches a policy that doesn't block anything, and this says why.
 */
export function reportedTools(a: Analysis): string[] {
  if (!a.patches.some((p) => a.parsed.policies[p.policyIndex]?.reportOnly)) return [];
  return a.vendors.filter((v) => v.reported).map((v) => v.vendor.name);
}

/** The note that goes with `reportedTools`, or an empty string. */
export function reportOnlyNote(a: Analysis, t: Translate): string {
  const tools = reportedTools(a);
  return tools.length === 0 ? '' : t('report.developer.reportOnly', { vendors: new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(tools) });
}

/** Markdown summary for developers: diff, full policies, nonce notes. */
export function developerReport(a: Analysis, t: Translate): string {
  const out: string[] = [`## ${t('report.developer.title')}`, ''];
  if (a.patches.length === 0) out.push(t('report.developer.noChange'));
  else {
    out.push(`### ${t('report.developer.diff')}`, '', '```diff', policyDiff(a), '```', '');
    const note = reportOnlyNote(a, t);
    if (note) out.push(note, '');
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
