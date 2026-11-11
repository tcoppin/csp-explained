import { DEFAULT_ORIGIN, overallVerdict, type VendorSelection } from './analysis';
import { requirementsOf } from './catalogue/requirements';
import { checkRequirements, type RequirementResult, type RequirementVerdict } from './csp/compat';
import { diffPolicies, type PolicyDiff } from './csp/diff';
import type { ParseResult } from './csp/model';
import { parse } from './csp/parser';
import { evaluateSecurity, type SecurityFinding } from './csp/security';

/** Better or worse for the site: a load that now works, or one that now fails. */
export type Trend = 'better' | 'worse' | 'same';

export interface RequirementChange {
  before: RequirementResult;
  after: RequirementResult;
  trend: Trend;
}

export interface VendorChange extends VendorSelection {
  verdictBefore: RequirementVerdict;
  verdictAfter: RequirementVerdict;
  /** Worse when anything the tool needs is newly held back, even if its overall verdict stays the same. */
  trend: Trend;
  requirements: RequirementChange[];
}

export interface Comparison {
  before: ParseResult;
  after: ParseResult;
  origin: string;
  policies: PolicyDiff[];
  /** Findings of the before policies that the after ones no longer have. */
  fixed: SecurityFinding[];
  /** Findings of the after policies that the before ones didn't have. */
  introduced: SecurityFinding[];
  /** Findings both sides have (the after side's copy). */
  remaining: SecurityFinding[];
  vendors: VendorChange[];
}

/** From the site's point of view: the further right, the more a tool is held back. */
const RANK: Record<RequirementVerdict, number> = { allowed: 0, reported: 1, 'needs-nonce': 2, blocked: 3 };

export function trendOf(before: RequirementVerdict, after: RequirementVerdict): Trend {
  return RANK[after] < RANK[before] ? 'better' : RANK[after] > RANK[before] ? 'worse' : 'same';
}

/**
 * A tool's verdict can stay the same while what it needs moves (images newly blocked, connections newly allowed):
 * anything newly held back makes the change worse for it, whatever its overall verdict.
 */
function toolTrend(overall: Trend, requirements: RequirementChange[]): Trend {
  if (overall !== 'same') return overall;
  if (requirements.some((r) => r.trend === 'worse')) return 'worse';
  return requirements.some((r) => r.trend === 'better') ? 'better' : 'same';
}

export function compare(beforeInput: string, afterInput: string, selections: VendorSelection[], origin = DEFAULT_ORIGIN): Comparison {
  const before = parse(beforeInput);
  const after = parse(afterInput);
  const policies = diffPolicies(before.policies, after.policies, origin);

  // A finding is the same on both sides when it is in paired policies: their positions may differ.
  const pairOfBefore = new Map(policies.map((p, i) => [p.beforeIndex, i]));
  const pairOfAfter = new Map(policies.map((p, i) => [p.afterIndex, i]));
  const key = (pairs: Map<number | undefined, number>, side: string) => (f: SecurityFinding) =>
    `${pairs.get(f.policyIndex) ?? `${side}${f.policyIndex}`}|${f.id}|${f.directive}|${f.value ?? ''}`;
  const beforeFindings = evaluateSecurity(before);
  const afterFindings = evaluateSecurity(after);
  const beforeKeys = new Set(beforeFindings.map(key(pairOfBefore, 'b')));
  const afterKeys = new Set(afterFindings.map(key(pairOfAfter, 'a')));

  const vendors = selections.map((s) => {
    const reqs = s.features.flatMap(requirementsOf);
    const resultsBefore = checkRequirements(before, reqs, origin);
    const resultsAfter = checkRequirements(after, reqs, origin);
    const requirements = resultsBefore.map((b, i) => {
      const a = resultsAfter[i]!;
      return { before: b, after: a, trend: trendOf(b.verdict, a.verdict) };
    });
    const verdictBefore = overallVerdict(resultsBefore);
    const verdictAfter = overallVerdict(resultsAfter);
    return { ...s, verdictBefore, verdictAfter, trend: toolTrend(trendOf(verdictBefore, verdictAfter), requirements), requirements };
  });

  return {
    before,
    after,
    origin,
    policies,
    fixed: beforeFindings.filter((f) => !afterKeys.has(key(pairOfBefore, 'b')(f))),
    introduced: afterFindings.filter((f) => !beforeKeys.has(key(pairOfAfter, 'a')(f))),
    remaining: afterFindings.filter((f) => beforeKeys.has(key(pairOfAfter, 'a')(f))),
    vendors,
  };
}
