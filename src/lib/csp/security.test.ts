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

  it('sorts by level', () => {
    const findings = evaluateSecurity(parse("script-src 'unsafe-inline' https:"));
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    const levels = findings.map((f) => order[f.level]);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});
