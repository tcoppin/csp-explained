import type { Translate } from '../../i18n';
import type { Analysis } from '../analysis';
import type { SecurityFinding } from '../csp/security';

export function countByLevel(findings: SecurityFinding[]) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  return counts;
}

function line(f: SecurityFinding, t: Translate, multiplePolicies: boolean): string {
  const level = t(`report.security.level.${f.level}`) + (f.maybe ? ` (${t('report.security.maybe')})` : '');
  const where = [f.directive, f.value].filter(Boolean).join(' ');
  const policy = multiplePolicies ? ` [policy ${f.policyIndex + 1}${f.reportOnly ? ', report-only' : ''}]` : '';
  return `- **${level}** \`${where}\`${policy}: ${f.description}`;
}

/** Markdown review: findings in the current policy and those the proposed change would add. */
export function securityReport(a: Analysis, t: Translate): string {
  const multiple = a.parsed.policies.length > 1;
  const counts = countByLevel(a.findings);
  const out: string[] = [`## ${t('report.security.title')}`, '', t('report.security.summary', counts), ''];
  if (a.parsed.policies.filter((p) => !p.reportOnly).length > 1) out.push(`> ${t('report.security.multiplePolicies')}`, '');

  if (a.vendors.length > 0) {
    out.push(`### ${t('report.security.introduced')}`, '');
    if (a.introducedFindings.length === 0) out.push(t('report.security.noneIntroduced'));
    else out.push(...a.introducedFindings.map((f) => line(f, t, multiple)));
    out.push('');
  }

  out.push(`### ${t('report.security.current')}`, '');
  if (a.findings.length === 0) out.push(t('report.security.noFindings'));
  else out.push(...a.findings.map((f) => line(f, t, multiple)));

  const strict = a.parsed.policies.some((p) =>
    p.directives.some((d) => d.values.some((v) => v.kind === 'keyword' && v.value === "'strict-dynamic'")),
  );
  if (!strict) out.push('', `> ${t('report.security.strictHint')}`);
  out.push('', `_${t('report.security.attribution')}_`);
  return out.join('\n');
}
