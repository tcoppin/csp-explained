import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVendor } from './catalogue/schema';
import { explainReports } from './violation-reports';

const vendorDir = join(import.meta.dirname, '../../catalogue/vendors');
const vendors = readdirSync(vendorDir).map((f) => parseVendor(readFileSync(join(vendorDir, f), 'utf8')));
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'csp/violation-reports', name), 'utf8');

const POLICY = "default-src 'self'; script-src 'self' 'nonce-abc'; report-to csp";
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0';

/** A Reporting API report, as a collector keeps it. */
const report = (body: Record<string, unknown>, userAgent = CHROME) =>
  JSON.stringify({
    type: 'csp-violation',
    user_agent: userAgent,
    body: { documentURL: 'https://shop.example.com/', originalPolicy: POLICY, disposition: 'enforce', ...body },
  });

describe('explainReports', () => {
  it('groups the reports about one address and rule, with their pages (without query strings) and browsers', () => {
    const hotjar = { blockedURL: 'https://static.hotjar.com/c/hotjar-1.js?sv=6', effectiveDirective: 'script-src-elem' };
    const input = [
      report({ ...hotjar, documentURL: 'https://shop.example.com/cart?coupon=X' }),
      report({ ...hotjar, documentURL: 'https://shop.example.com/cart?coupon=Y' }, FIREFOX),
      report({ ...hotjar, documentURL: 'https://shop.example.com/' }),
      report({ blockedURL: 'https://region1.google-analytics.com/g/collect?v=2', effectiveDirective: 'connect-src' }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.total).toBe(4);
    expect(e.origin).toBe('https://shop.example.com');
    expect(e.groups).toHaveLength(2);
    const [first, second] = e.groups;
    expect(first).toMatchObject({ reports: 3, pages: [{ page: '/cart', reports: 2 }, { page: '/', reports: 1 }], browsers: ['Chrome', 'Firefox'] });
    expect(first!.explained.case).toBe('address');
    expect(first!.explained.tools.map((t) => t.vendor.id)).toContain('hotjar');
    expect(first!.explained.violation).toMatchObject({ directive: 'script-src', effective: 'script-src-elem' });
    expect(second!.explained.fix).toMatchObject({ directive: 'connect-src', created: true, inLines: true });
    // One line per rule, on the whole policy: connect-src is created from default-src.
    expect(e.lines.map((l) => l.line)).toEqual(["script-src 'self' 'nonce-abc' https://static.hotjar.com", "connect-src 'self' https://*.google-analytics.com"]);
    expect(e.policies).toEqual([
      {
        text: POLICY,
        reportOnly: false,
        guessed: false,
        reports: 4,
        fixed: {
          before: POLICY,
          after: "default-src 'self'; script-src 'self' 'nonce-abc' https://static.hotjar.com; report-to csp; connect-src 'self' https://*.google-analytics.com",
          reportOnly: false,
        },
      },
    ]);
  });

  it("sets apart what browser extensions asked for, and keeps it out of the lines", () => {
    const input = [
      report({ blockedURL: 'chrome-extension://abcdefghijklmnop/content.js', effectiveDirective: 'script-src-elem' }),
      report({ blockedURL: 'https://tracker.example.net/pixel', effectiveDirective: 'img-src', sourceFile: 'moz-extension://1234/inject.js' }, FIREFOX),
      report({ blockedURL: 'inline', effectiveDirective: 'script-src-elem', sourceFile: 'chrome-extension://abcdefghijklmnop/content.js' }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.groups).toEqual([]);
    expect(e.noise.map((g) => [g.explained.case, g.explained.host])).toEqual([
      ['extension', 'abcdefghijklmnop'],
      ['extension', '1234'],
      ['extension', 'abcdefghijklmnop'],
    ]);
    expect(e.lines).toEqual([]);
  });

  it('keeps each policy apart: enforced and report-only, and an older one', () => {
    const eval_ = { blockedURL: 'eval', effectiveDirective: 'script-src' };
    const input = [
      report(eval_),
      report({ ...eval_, disposition: 'report', originalPolicy: "script-src 'self'" }),
      report({ ...eval_, originalPolicy: "script-src 'self' https://old.example.com" }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.policies.map((p) => [p.text, p.reportOnly])).toEqual([
      [POLICY, false],
      ["script-src 'self'", true],
      ["script-src 'self' https://old.example.com", false],
    ]);
    expect(e.groups.map((g) => g.policy).sort()).toEqual([0, 1, 2]);
    expect(e.lines.map((l) => [l.line, l.reportOnly, l.policy])).toEqual([
      ["script-src 'self' 'nonce-abc' 'unsafe-eval'", false, POLICY],
      ["script-src 'self' 'unsafe-eval'", true, "script-src 'self'"],
      ["script-src 'self' https://old.example.com 'unsafe-eval'", false, "script-src 'self' https://old.example.com"],
    ]);
  });

  it('reads Trusted Types reports: the sink from the sample, and policy names the rule refuses', () => {
    const input = [
      report({ blockedURL: 'trusted-types-sink', effectiveDirective: 'require-trusted-types-for', sample: 'Element innerHTML|<img src=x onerror=…' }),
      report({ blockedURL: 'trusted-types-policy', effectiveDirective: 'trusted-types', sample: 'dompurify' }),
      report({ blockedURL: 'trusted-types-policy', effectiveDirective: 'trusted-types', sample: 'dompurify' }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.groups.map((g) => [g.explained.case, g.explained.violation.sink, g.explained.violation.trustedType])).toEqual([['trusted-types', 'Element.innerHTML', 'TrustedHTML']]);
    expect(e.names).toEqual([{ name: 'dompurify', reports: 2, policy: 0 }]);
  });

  it("adds a style attribute's own rule to the fixed policy", () => {
    const e = explainReports(report({ blockedURL: 'inline', effectiveDirective: 'style-src-attr' }), vendors);
    expect(e.lines.map((l) => l.line)).toEqual(["style-src-attr 'unsafe-inline'"]);
    expect(e.policies[0]!.fixed?.after).toBe(`${POLICY}; style-src-attr 'unsafe-inline'`);
  });

  it("explains every browser's reports the same way", () => {
    const summary = (name: string) => {
      const e = explainReports(fixture(name), vendors);
      return { groups: e.groups.map((g) => `${g.explained.case} ${g.explained.violation.directive}`).sort(), lines: e.lines.map((l) => l.line).sort() };
    };
    const chromium = summary('chromium-report-uri.ndjson');
    expect(chromium.groups).toHaveLength(16);
    expect(chromium.lines).toContain("connect-src 'self' https://*.google-analytics.com");
    expect(summary('firefox-report-uri.ndjson')).toEqual(chromium);
    expect(summary('firefox-reporting-api.json')).toEqual(chromium);
    expect(summary('webkit-reporting-api.ndjson')).toEqual(chromium);
  });
});
