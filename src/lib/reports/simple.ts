import type { Translate } from '../../i18n';
import type { Analysis, VendorCheck } from '../analysis';
import { patchedPolicies } from '../analysis';
import type { DirectiveChange } from '../csp/patch';

export type MessageFormat = 'email' | 'chat' | 'ticket';

export interface ItRequestOptions {
  format: MessageFormat;
  /** The user's site, if they gave it. */
  site?: string;
  /** Where this tool is hosted, for the attribution line. */
  toolUrl: string;
}

interface Sections {
  subject: string;
  intro: string;
  vendorLines: string[];
  changes: string[];
  policies: string[];
  risks: string[];
  sources: string[];
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

function vendorLine(v: VendorCheck, t: Translate): string {
  const name = v.vendor.name;
  switch (v.verdict) {
    case 'allowed':
      return t('report.simple.okLine', { vendor: name });
    case 'reported':
      return t('report.simple.reportedLine', { vendor: name });
    case 'needs-nonce':
      return t('report.simple.needsNonceLine', { vendor: name, how: v.vendor.nonce?.how ?? t('report.simple.needsNonceNoHow') });
    case 'blocked': {
      const byType = new Map<string, Set<string>>();
      for (const r of v.results.filter((r) => r.verdict === 'blocked')) {
        const label = t(`resources.${r.requirement.type}`).toLowerCase();
        byType.set(label, (byType.get(label) ?? new Set()).add(r.requirement.source));
      }
      const items = [...byType].map(([label, sources]) => `${label} (${[...sources].join(', ')})`);
      return t('report.simple.blockedLine', { vendor: name, items: list(items) });
    }
  }
}

function changeLine(c: DirectiveChange, t: Translate): string {
  const values = c.added.join(' ');
  return c.created ? t('report.simple.changeCreate', { directive: c.directive, values }) : t('report.simple.changeAdd', { directive: c.directive, values });
}

function risks(a: Analysis, t: Translate): string[] {
  const out = new Set<string>();
  for (const v of a.vendors) {
    for (const r of v.results) {
      if (r.verdict !== 'blocked') continue;
      const { type, source } = r.requirement;
      const vendor = v.vendor.name;
      if (source === "'unsafe-inline'" && (type === 'inline-script' || type === 'inline-handler')) {
        out.add(t('report.simple.risk.unsafe-inline-script', { vendor, how: v.vendor.nonce?.how ?? '' }).trim());
      } else if (source === "'unsafe-inline'") {
        out.add(t('report.simple.risk.unsafe-inline-style', { vendor }));
      } else if (source === "'unsafe-eval'") {
        const feature = v.features.find((f) => f.requirements.some((req) => req.sources.includes(source)));
        out.add(t('report.simple.risk.unsafe-eval', { vendor, feature: feature?.label ?? '' }));
      } else if (type === 'script' && source.includes('*.')) {
        out.add(t('report.simple.risk.wildcard', { vendor, source }));
      }
    }
  }
  return [...out];
}

function sections(a: Analysis, t: Translate, opts: ItRequestOptions): Sections {
  const vendors = list(a.vendors.map((v) => v.vendor.name));
  const site = opts.site || 'our website';
  const needsAction = a.vendors.some((v) => v.verdict !== 'allowed');
  return {
    subject: t('report.simple.subject', { vendors }),
    intro: needsAction ? t('report.simple.intro', { vendors, site }) : t('report.simple.introOk', { vendors, site }),
    vendorLines: needsAction ? a.vendors.map((v) => vendorLine(v, t)) : [],
    changes: a.patches.flatMap((p) => p.changes.map((c) => changeLine(c, t))),
    policies: a.patches.length > 0 ? patchedPolicies(a).map((p) => p.text) : [],
    risks: risks(a, t),
    sources: [...new Set(a.vendors.filter((v) => v.verdict !== 'allowed').flatMap((v) => v.vendor.sources.map((s) => `${v.vendor.name}: ${s}`)))],
  };
}

/** A message a non-technical person can send to their IT / security team as-is. */
export function itRequest(a: Analysis, t: Translate, opts: ItRequestOptions): string {
  const s = sections(a, t, opts);
  const footer = t('report.simple.generatedBy', { site: opts.toolUrl });
  const out: string[] = [];

  if (opts.format === 'email') {
    out.push(`Subject: ${s.subject}`, '', t('report.simple.greeting'), '', s.intro);
    if (s.vendorLines.length) out.push('', ...s.vendorLines.map((l) => `- ${l}`));
    if (s.changes.length) out.push('', t('report.simple.changeTitle'), ...s.changes.map((l) => `- ${l}`));
    if (s.policies.length) out.push('', t('report.simple.fullPolicy'), '', ...s.policies.map((p) => `    ${p}`));
    if (s.risks.length) out.push('', t('report.simple.risksTitle'), ...s.risks.map((l) => `- ${l}`));
    if (s.sources.length) out.push('', t('report.simple.sources'), ...s.sources.map((l) => `- ${l}`));
    out.push('', t('report.simple.closing'), '', t('report.simple.thanks'), '', '--', footer);
  } else if (opts.format === 'chat') {
    out.push(`*${s.subject}*`, s.intro);
    if (s.vendorLines.length) out.push(...s.vendorLines.map((l) => `• ${l}`));
    if (s.changes.length) out.push('', `*${t('report.simple.changeTitle')}*`, ...s.changes.map((l) => `• ${l}`));
    if (s.policies.length) out.push('```', ...s.policies, '```');
    if (s.risks.length) out.push(`*${t('report.simple.risksTitle')}*`, ...s.risks.map((l) => `• ${l}`));
    if (s.sources.length) out.push(...s.sources.map((l) => `• ${l}`));
    out.push(t('report.simple.closing'), `_${footer}_`);
  } else {
    out.push(`## ${s.subject}`, '', s.intro);
    if (s.vendorLines.length) out.push('', ...s.vendorLines.map((l) => `- ${l}`));
    if (s.changes.length) out.push('', `### ${t('report.simple.changeTitle')}`, '', ...s.changes.map((l) => `- ${l}`));
    if (s.policies.length) out.push('', t('report.simple.fullPolicy'), '', '```', ...s.policies, '```');
    if (s.risks.length) out.push('', `### ${t('report.simple.risksTitle')}`, '', ...s.risks.map((l) => `- ${l}`));
    if (s.sources.length) out.push('', `### ${t('report.simple.sources')}`, '', ...s.sources.map((l) => `- ${l}`));
    out.push('', `_${footer}_`);
  }
  return out.join('\n');
}
