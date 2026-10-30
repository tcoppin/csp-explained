import type { Csp } from 'csp_evaluator/dist/csp.js';
import { CspEvaluator, DEFAULT_CHECKS } from 'csp_evaluator/dist/evaluator.js';
import { Finding, Severity, Type } from 'csp_evaluator/dist/finding.js';
import { CspParser } from 'csp_evaluator/dist/parser.js';
import type { ParseResult, Policy } from './model';

/**
 * Security findings come from Google's CSP Evaluator (Apache-2.0), which encodes
 * years of research on allowlist bypasses. We only map its output to our own levels.
 */

export type Level = 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  /** Stable id, e.g. `script-unsafe-inline`; used to look up plain-language copy. */
  id: string;
  level: Level;
  /** True when the evaluator is unsure (e.g. "possible bypass"). */
  maybe: boolean;
  directive: string;
  value?: string;
  /** The evaluator's own description, in English; shown only when we have no message for the finding (`findingKey`). */
  description: string;
  policyIndex: number;
  reportOnly: boolean;
}

const LEVELS: Record<Severity, Level> = {
  [Severity.HIGH]: 'high',
  [Severity.HIGH_MAYBE]: 'high',
  [Severity.MEDIUM]: 'medium',
  [Severity.MEDIUM_MAYBE]: 'medium',
  [Severity.SYNTAX]: 'medium',
  [Severity.STRICT_CSP]: 'low',
  [Severity.INFO]: 'info',
  [Severity.NONE]: 'info',
};

const ORDER: Record<Level, number> = { high: 0, medium: 1, low: 2, info: 3 };

const idOf = (type: Type) => (Type[type] ?? String(type)).toLowerCase().replace(/_/g, '-');

/**
 * Rebuilds the policy without the values our parser found invalid: we report those ourselves,
 * and some of the evaluator's checks pass every value to `new URL()`, which throws on them in browsers.
 */
function sanitized(policy: Policy): string {
  return policy.directives
    .filter((d) => !d.duplicate)
    .map((d) => [d.name, ...d.values.filter((v) => v.kind !== 'invalid').map((v) => v.raw)].join(' '))
    .join('; ');
}

/** Like CspEvaluator.evaluate(), but one failing check doesn't discard the others. */
function runChecks(csp: Csp): Finding[] {
  const evaluator = new CspEvaluator(csp);
  const findings: Finding[] = [];
  const effective = csp.getEffectiveCsp(evaluator.version, findings);
  for (const check of DEFAULT_CHECKS) {
    try {
      findings.push(...check(effective));
    } catch {
      // A check crashed on unusual input; keep the other findings.
    }
  }
  return findings;
}

/**
 * Which of our messages (`findings.*` in the i18n messages) explains a finding. Some evaluator types say
 * different things depending on the directive, the value or how sure it is, so those have one message each.
 */
export function findingKey(f: Pick<SecurityFinding, 'id' | 'directive' | 'value' | 'maybe'>): string {
  const value = f.value ?? '';
  switch (f.id) {
    case 'missing-directives':
      return `${f.id}.${f.directive}`;
    case 'script-allowlist-bypass':
      return `${f.id}.${value === "'self'" ? 'self' : f.maybe ? 'unverified' : 'known'}`;
    case 'object-allowlist-bypass':
      return `${f.id}.${f.maybe ? 'restrict' : 'known'}`;
    case 'ip-source':
      return `${f.id}.${value.includes('127.0.0.1') ? 'localhost' : 'ip'}`;
    case 'src-http':
      return `${f.id}.${f.directive === 'report-uri' ? 'report' : 'resource'}`;
    case 'unknown-directive':
      return `${f.id}.${f.directive.endsWith(':') ? 'colon' : 'unknown'}`;
    case 'invalid-keyword':
      return `${f.id}.${value.startsWith("'") ? 'invalid' : 'quotes'}`;
    case 'ignored':
      return `${f.id}.${value === "'unsafe-inline'" ? 'unsafe-inline' : 'strict-dynamic'}`;
    default:
      return f.id;
  }
}

export function evaluateSecurity(parsed: Pick<ParseResult, 'policies'>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  parsed.policies.forEach((policy, policyIndex) => {
    if (policy.directives.length === 0) return;
    const csp = new CspParser(sanitized(policy)).csp;
    for (const f of runChecks(csp)) {
      findings.push({
        id: idOf(f.type),
        level: LEVELS[f.severity] ?? 'info',
        maybe: f.severity === Severity.HIGH_MAYBE || f.severity === Severity.MEDIUM_MAYBE,
        directive: f.directive,
        value: f.value,
        description: f.description,
        policyIndex,
        reportOnly: policy.reportOnly,
      });
    }
  });
  return findings.sort((a, b) => ORDER[a.level] - ORDER[b.level] || Number(a.maybe) - Number(b.maybe));
}
