import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { allowsOpenCdn, evaluateSecurity, findingKey } from './security';

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

  it("doesn't call the fallbacks of a strict policy risky: browsers that know 'strict-dynamic' skip them", () => {
    const findings = evaluateSecurity(
      parse("script-src 'nonce-r4nd0mR4nd0mR4nd0m' 'strict-dynamic' https: 'unsafe-inline'; object-src 'none'; base-uri 'none'"),
    );
    expect(findings.filter((f) => f.level === 'high' || f.level === 'medium')).toEqual([]);
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

describe('CDNs anyone can publish to', () => {
  const bypass = (policy: string) => evaluateSecurity(parse(policy)).filter((f) => f.id === 'script-allowlist-bypass' && f.value !== "'self'");

  it('flags all of unpkg as a sure, high bypass, though the evaluator only suspects it', () => {
    const [f] = bypass("script-src 'self' https://unpkg.com; object-src 'none'");
    expect(f).toMatchObject({ level: 'high', maybe: false, value: 'https://unpkg.com' });
    expect(findingKey(f!)).toBe('script-allowlist-bypass.open-cdn');
  });

  it('says the same about jsDelivr, which the evaluator already knows', () => {
    const [f] = bypass("script-src https://cdn.jsdelivr.net; object-src 'none'");
    expect(f).toMatchObject({ level: 'high', maybe: false });
    expect(findingKey(f!)).toBe('script-allowlist-bypass.open-cdn');
  });

  it('also catches them through default-src', () => {
    expect(bypass("default-src 'self' unpkg.com")[0]).toMatchObject({ directive: 'default-src', level: 'high' });
  });

  it("leaves one package's address to the usual check", () => {
    const [f] = bypass("script-src https://unpkg.com/vue@3/; object-src 'none'");
    expect(f).toMatchObject({ level: 'medium', maybe: true });
    expect(findingKey(f!)).toBe('script-allowlist-bypass.unverified');
  });

  it('knows a whole CDN from one of its packages', () => {
    for (const v of ['https://unpkg.com', 'unpkg.com', 'https://unpkg.com/', 'https://cdn.jsdelivr.net', 'https://*.jsdelivr.net', 'https://esm.sh', 'https://cdn.skypack.dev', 'https://ga.jspm.io']) expect(allowsOpenCdn(v), v).toBe(true);
    for (const v of ['https://unpkg.com/vue@3/', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.9/', 'https://cdnjs.cloudflare.com', 'https://unpkg.com.evil.example', 'https://ga.jspm.io/npm:lit@3.3.0/', "'self'", undefined]) {
      expect(allowsOpenCdn(v), String(v)).toBe(false);
    }
  });
});
