import { requirementsOf, type Feature, type Vendor } from './catalogue/schema';
import { checkRequirements, type RequirementResult, type RequirementVerdict } from './csp/compat';
import type { ParseResult } from './csp/model';
import { parse } from './csp/parser';
import { buildPatches, type PolicyPatch } from './csp/patch';
import { evaluateSecurity, type SecurityFinding } from './csp/security';

/** Placeholder origin used for 'self' when the user didn't tell us their site. */
export const DEFAULT_ORIGIN = 'https://your-site.example';

export interface VendorSelection {
  vendor: Vendor;
  features: Feature[];
}

export interface VendorCheck extends VendorSelection {
  results: RequirementResult[];
  verdict: RequirementVerdict;
}

export interface Analysis {
  parsed: ParseResult;
  origin: string;
  vendors: VendorCheck[];
  patches: PolicyPatch[];
  findings: SecurityFinding[];
  /** Findings that would only appear once the patches are applied. */
  introducedFindings: SecurityFinding[];
}

const RANK: Record<RequirementVerdict, number> = { allowed: 0, reported: 1, 'needs-nonce': 2, blocked: 3 };

export function overallVerdict(results: RequirementResult[]): RequirementVerdict {
  return results.reduce<RequirementVerdict>((acc, r) => (RANK[r.verdict] > RANK[acc] ? r.verdict : acc), 'allowed');
}

const findingKey = (f: SecurityFinding) => `${f.policyIndex}|${f.id}|${f.directive}|${f.value ?? ''}`;

export function analyze(input: string, selections: VendorSelection[], origin = DEFAULT_ORIGIN): Analysis {
  const parsed = parse(input);
  const vendors = selections.map((s) => {
    const results = checkRequirements(parsed, s.features.flatMap(requirementsOf), origin);
    return { ...s, results, verdict: overallVerdict(results) };
  });
  const patches = buildPatches(parsed, vendors.flatMap((v) => v.results));
  const findings = evaluateSecurity(parsed);

  let introducedFindings: SecurityFinding[] = [];
  if (patches.length > 0) {
    const patchedPolicies = parsed.policies.map((p, i) => patches.find((x) => x.policyIndex === i)?.after ?? p.text);
    const patched = parse(patchedPolicies.join(', '));
    patched.policies.forEach((p, i) => (p.reportOnly = parsed.policies[i]?.reportOnly ?? false));
    const before = new Set(findings.map(findingKey));
    introducedFindings = evaluateSecurity(patched).filter((f) => !before.has(findingKey(f)));
  }

  return { parsed, origin, vendors, patches, findings, introducedFindings };
}

/** The patched version of every policy (unchanged ones included), in order. */
export function patchedPolicies(a: Analysis): { text: string; reportOnly: boolean; changed: boolean }[] {
  return a.parsed.policies.map((p, i) => {
    const patch = a.patches.find((x) => x.policyIndex === i);
    return { text: patch?.after ?? p.text, reportOnly: p.reportOnly, changed: patch !== undefined };
  });
}
