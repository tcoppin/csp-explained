import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { evaluateSecurity } from './security';

describe('evaluateSecurity', () => {
  it("flags 'unsafe-inline' in script-src as high", () => {
    const findings = evaluateSecurity(parse("script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'"));
    expect(findings[0]).toMatchObject({ id: 'script-unsafe-inline', level: 'high', directive: 'script-src' });
  });

  it('returns findings for every policy, keeping report-only information', () => {
    const findings = evaluateSecurity(parse("Content-Security-Policy-Report-Only: script-src *"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.reportOnly)).toBe(true);
  });

  it('ignores values our parser found invalid', () => {
    const findings = evaluateSecurity(parse("script-src 'self' 'sha256-…'; object-src 'none'; base-uri 'none'"));
    expect(findings.some((f) => f.value === "'sha256-…'")).toBe(false);
  });

  it("doesn't flag CSP Level 3 keywords the evaluator doesn't know yet", () => {
    const findings = evaluateSecurity(
      parse("script-src 'nonce-r4nd0mR4nd0mR4nd0m' 'strict-dynamic' 'trusted-types-eval' 'report-sha256'; object-src 'none'; base-uri 'none'"),
    );
    expect(findings.filter((f) => f.id === 'invalid-keyword')).toEqual([]);
  });

  it("doesn't call directives the evaluator doesn't know yet unknown", () => {
    const findings = evaluateSecurity(parse("script-src 'self'; object-src 'none'; base-uri 'none'; fenced-frame-src https:"));
    expect(findings.filter((f) => f.id === 'unknown-directive')).toEqual([]);
  });

  it('still flags keywords written without quotes', () => {
    const findings = evaluateSecurity(parse("script-src self; object-src 'none'; base-uri 'none'"));
    expect(findings.some((f) => f.id === 'invalid-keyword')).toBe(true);
  });

  it('reports each finding once, though the evaluator raises some once per kind of script', () => {
    const findings = evaluateSecurity(parse("script-src 'strict-dynamic' https:; object-src 'none'; base-uri 'none'"));
    expect(findings.filter((f) => f.id === 'ignored' && f.value === 'https:')).toHaveLength(1);
  });

  it('sorts by level', () => {
    const findings = evaluateSecurity(parse("script-src 'unsafe-inline' https:"));
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    const levels = findings.map((f) => order[f.level]);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});
