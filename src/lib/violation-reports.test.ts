import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVendor } from './catalogue/schema';
import { explainReports, isSensitive, siteOf } from './violation-reports';

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

  it('keeps an address no tool uses, outside the site, out of the lines until the visitor says they know it', () => {
    const input = [
      report({ blockedURL: 'https://cdn.jquery-libs.example/jquery.min.js', effectiveDirective: 'script-src-elem' }),
      report({ blockedURL: 'https://img.example.com/a.png', effectiveDirective: 'img-src' }),
      report({ blockedURL: 'data', effectiveDirective: 'img-src' }),
    ].join('\n');
    const e = explainReports(input, vendors);
    const skimmer = e.groups.find((g) => g.explained.host === 'cdn.jquery-libs.example')!;
    expect(skimmer).toMatchObject({ unknown: true });
    expect(skimmer.explained.fix).toBeUndefined();
    // The site's own domain, and a local scheme, aren't unknown.
    expect(e.groups.filter((g) => g.unknown)).toHaveLength(1);
    expect(e.lines.map((l) => l.line)).toEqual(["img-src 'self' https://img.example.com data:"]);
    expect(e.policies[0]!.fixed?.after).not.toContain('jquery-libs');

    const vouched = explainReports(input, vendors, { trusted: new Set([skimmer.key]) });
    expect(vouched.groups.find((g) => g.key === skimmer.key)).toMatchObject({ unknown: true, explained: { fix: { inLines: true } } });
    expect(vouched.lines.map((l) => l.line)).toContain("script-src 'self' 'nonce-abc' https://cdn.jquery-libs.example");
  });

  it('reads an older policy against the newest one: what it allows now is set apart, the rest is a problem of the newest', () => {
    const OLD = "default-src 'self'; script-src 'self'";
    const NEW = "default-src 'self'; script-src 'self' https://static.hotjar.com";
    const at = (day: number) => ({ timestamp: Date.UTC(2026, 10, day) });
    const dated = (day: number, body: Record<string, unknown>) => JSON.stringify({ ...at(day), ...JSON.parse(report(body)) });
    const hotjar = { blockedURL: 'https://static.hotjar.com/c/hotjar-1.js', effectiveDirective: 'script-src-elem' };
    const ga = { blockedURL: 'https://region1.google-analytics.com/g/collect', effectiveDirective: 'connect-src' };
    const input = [
      dated(10, { ...hotjar, originalPolicy: OLD }),
      dated(11, { ...hotjar, originalPolicy: OLD }),
      dated(11, { ...ga, originalPolicy: OLD }),
      dated(14, { ...ga, originalPolicy: NEW }),
      dated(15, { ...ga, originalPolicy: NEW }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.period).toEqual({ from: Date.UTC(2026, 10, 10), to: Date.UTC(2026, 10, 15) });
    expect(e.policies.map((p) => [p.text, p.replacedBy, p.last])).toEqual([
      [OLD, 1, Date.UTC(2026, 10, 11)],
      [NEW, undefined, Date.UTC(2026, 10, 15)],
    ]);
    // Hotjar's script was blocked by the old policy only: the new one allows it.
    expect(e.allowed.map((g) => [g.explained.host, g.reports, g.policy])).toEqual([['static.hotjar.com', 2, 1]]);
    // Analytics, blocked by both, is one problem of the new policy, from its first report to its last.
    expect(e.groups.map((g) => [g.explained.host, g.reports, g.policy, g.first, g.last])).toEqual([
      ['region1.google-analytics.com', 3, 1, Date.UTC(2026, 10, 11), Date.UTC(2026, 10, 15)],
    ]);
    expect(e.lines.map((l) => [l.policy, l.line])).toEqual([[NEW, "connect-src 'self' https://*.google-analytics.com"]]);
    expect(e.policies[1]!.fixed?.before).toBe(NEW);

    // Since the 14th: only the new policy's reports.
    const since = explainReports(input, vendors, { since: Date.UTC(2026, 10, 14) });
    expect([since.total, since.before, since.undated, since.policies.length, since.allowed.length]).toEqual([2, 3, 0, 1, 0]);
    expect(since.period).toEqual(e.period);
  });

  it('keeps policies that overlap in time apart: neither replaced the other', () => {
    const A = "default-src 'self'; img-src 'self'";
    const B = "default-src 'self'";
    const dated = (day: number, policy: string) => JSON.stringify({ timestamp: Date.UTC(2026, 10, day), ...JSON.parse(report({ blockedURL: 'eval', effectiveDirective: 'script-src', originalPolicy: policy })) });
    const e = explainReports([dated(10, A), dated(12, B), dated(13, A)].join('\n'), vendors);
    expect(e.policies.map((p) => p.replacedBy)).toEqual([undefined, undefined]);
    expect(e.groups).toHaveLength(2);
  });

  it('sets apart what the site didn\'t cause, by cause, and keeps it out of the lines', () => {
    const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0';
    const GOOGLEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/142.0.0.0 Safari/537.36';
    const CUBOT = 'Mozilla/5.0 (Linux; Android 12; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
    const script = (url: string) => ({ blockedURL: url, effectiveDirective: 'script-src-elem' });
    const input = [
      report(script('chrome-extension://abc/content.js')),
      report(script('https://gc.kis.v2.scr.kaspersky-labs.com/X/main.js')),
      report({ blockedURL: 'https://translate.googleapis.com/translate_static/css/translateelement.css', effectiveDirective: 'style-src-elem' }),
      report({ ...script('https://static.hotjar.com/c/hotjar-1.js'), documentURL: 'https://shop-example-com.translate.goog/' }),
      report(script('https://in-app.example/x.js'), INSTAGRAM),
      report(script('https://crawl.example/x.js'), GOOGLEBOT),
      report({ ...script('https://cached.example/x.js'), documentURL: 'https://webcache.googleusercontent.com/search?q=cache:shop.example.com' }),
      report({ ...script('https://saved.example/x.js'), documentURL: 'file:///Users/someone/Downloads/shop.html' }),
      report({ blockedURL: 'about', effectiveDirective: 'frame-src' }),
      // Seen in a normal browser too, or from a phone whose name has "bot" in it: the site's.
      report(script('https://cdn.us.heap-api.com/js/heap.js'), INSTAGRAM),
      report(script('https://cdn.us.heap-api.com/js/heap.js')),
      report({ blockedURL: 'https://region1.google-analytics.com/g/collect', effectiveDirective: 'connect-src' }, CUBOT),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.origin).toBe('https://shop.example.com');
    expect(e.noise.map((g) => [g.noise, g.explained.host])).toEqual([
      ['extension', 'abc'],
      ['software', 'gc.kis.v2.scr.kaspersky-labs.com'],
      ['translation', 'translate.googleapis.com'],
      ['translation', 'static.hotjar.com'],
      ['in-app', 'in-app.example'],
      ['bot', 'crawl.example'],
      ['copy', 'cached.example'],
      ['copy', 'saved.example'],
      ['browser', undefined],
    ]);
    expect(e.noise.every((g) => !g.explained.fix && !g.unknown)).toBe(true);
    expect(e.groups.map((g) => g.explained.host)).toEqual(['cdn.us.heap-api.com', 'region1.google-analytics.com']);
    expect(e.lines.map((l) => l.line)).toEqual(["script-src 'self' 'nonce-abc' https://cdn.us.heap-api.com", "connect-src 'self' https://*.google-analytics.com"]);
  });

  it('ranks problems by risk, not by count: an unknown address, then what is mostly on checkout or sign-in pages, then code blocked, then looks', () => {
    const at = (path: string, body: Record<string, unknown>, day = 13) =>
      JSON.stringify({ timestamp: Date.UTC(2026, 10, day), ...JSON.parse(report({ documentURL: `https://shop.example.com${path}`, ...body })) });
    const hotjar = { blockedURL: 'https://static.hotjar.com/c/hotjar-1.js', effectiveDirective: 'script-src-elem' };
    const font = { blockedURL: 'https://fonts.gstatic.com/s/a.woff2', effectiveDirective: 'font-src' };
    const input = [
      // Busy, blocked everywhere (the checkout too, but not mostly).
      ...['/', '/a', '/b', '/checkout', '/c', '/d'].flatMap((p) => [at(p, hotjar), at(p, hotjar, 19)]),
      ...['/', '/a', '/b'].flatMap((p) => [at(p, font), at(p, font, 19)]),
      // Few reports, on the checkout only.
      at('/checkout/payment', { blockedURL: 'inline', effectiveDirective: 'script-src-elem' }, 14),
      at('/checkout/payment', { blockedURL: 'inline', effectiveDirective: 'script-src-elem' }, 18),
      // New, no tool uses it.
      at('/login', { blockedURL: 'https://cdn.evil.example/x.js', effectiveDirective: 'script-src-elem' }, 18),
      // Gone well before the end.
      at('/', { blockedURL: 'https://cdn.us.heap-api.com/js/heap.js', effectiveDirective: 'script-src-elem' }, 13),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.groups.map((g) => [g.explained.host ?? g.explained.case, g.risk?.level, g.risk?.reasons.map((r) => r.kind).join(' ')])).toEqual([
      ['cdn.evil.example', 'high', 'unknown sensitive enforced code new'],
      ['inline', 'high', 'sensitive enforced code'],
      ['static.hotjar.com', 'medium', 'enforced code'],
      // A font still missing over a tool no longer reported.
      ['fonts.gstatic.com', 'low', 'enforced look'],
      ['cdn.us.heap-api.com', 'low', 'enforced code stopped'],
    ]);
    // Vouched for: no longer unknown, still on the sign-in page.
    const evil = e.groups[0]!;
    const trusted = explainReports(input, vendors, { trusted: new Set([evil.key]) });
    expect(trusted.groups.find((g) => g.key === evil.key)!.risk!.reasons.map((r) => r.kind)).toEqual(['sensitive', 'enforced', 'code', 'new']);
  });

  it('tells pages where visitors pay or sign in, word by word', () => {
    expect(['/checkout?step=2', '/fr/panier', '/account/orders', '/sign-in', '/de/warenkorb', 'https://shop.example.com/login'].every(isSensitive)).toBe(true);
    expect(['/', '/display', '/products/payload-bag', '/blog/signing-off', '/cartoons'].some(isSensitive)).toBe(false);
  });

  it('says whether a report-only policy can be enforced: not yet, too soon to say, or ready', () => {
    const TRIAL = "default-src 'self'; script-src 'self'; report-to csp";
    const at = (day: number, body: Record<string, unknown>) =>
      JSON.stringify({ timestamp: Date.UTC(2026, 10, day), ...JSON.parse(report({ disposition: 'report', originalPolicy: TRIAL, ...body })) });
    const hotjar = { blockedURL: 'https://static.hotjar.com/c/hotjar-1.js', effectiveDirective: 'script-src-elem' };
    const handler = { blockedURL: 'inline', effectiveDirective: 'script-src-attr' };
    const extension = { blockedURL: 'chrome-extension://abc/content.js', effectiveDirective: 'script-src-elem' };

    // Something the site uses: the lines settle one, the event handler needs the code to change.
    const notYet = explainReports([at(1, hotjar), at(9, handler), at(9, extension), report(hotjar)].join('\n'), vendors);
    expect(notYet.readiness).toEqual([{ policy: 0, verdict: 'not-yet', blocking: 2, inLines: 1, days: 8, noise: 1 }]);
    // The enforced policy has nothing to decide.
    expect(notYet.policies.map((p) => p.reportOnly)).toEqual([true, false]);

    // Only what the site didn't cause: ready after a week, too soon before, or without dates.
    expect(explainReports([at(1, extension), at(9, extension)].join('\n'), vendors).readiness).toEqual([{ policy: 0, verdict: 'ready', blocking: 0, inLines: 0, days: 8, noise: 2 }]);
    expect(explainReports([at(1, extension), at(3, extension)].join('\n'), vendors).readiness[0]).toMatchObject({ verdict: 'too-soon', days: 2 });
    const undated = explainReports(report({ ...extension, disposition: 'report', originalPolicy: TRIAL }), vendors).readiness[0]!;
    expect(undated.verdict).toBe('too-soon');
    expect(undated.days).toBeUndefined();
    // An unknown address left out of the lines still keeps it from being ready.
    expect(explainReports([at(1, { blockedURL: 'https://cdn.evil.example/x.js', effectiveDirective: 'script-src-elem' }), at(9, extension)].join('\n'), vendors).readiness[0]).toMatchObject({ verdict: 'not-yet', blocking: 1, inLines: 0 });
  });

  it('tells a domain from its subdomains', () => {
    expect(siteOf('cdn.shop.example.com')).toBe('example.com');
    expect(siteOf('www.shop.co.uk')).toBe('shop.co.uk');
    expect(siteOf('example.com')).toBe('example.com');
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
  });

  it('keeps each policy apart: enforced and report-only, and an older one', () => {
    const ga = { blockedURL: 'https://region1.google-analytics.com/g/collect', effectiveDirective: 'connect-src' };
    const input = [
      report(ga),
      report({ ...ga, disposition: 'report', originalPolicy: "connect-src 'self'" }),
      report({ ...ga, originalPolicy: "connect-src 'self' https://old.example.com" }),
    ].join('\n');
    const e = explainReports(input, vendors);
    expect(e.policies.map((p) => [p.text, p.reportOnly])).toEqual([
      [POLICY, false],
      ["connect-src 'self'", true],
      ["connect-src 'self' https://old.example.com", false],
    ]);
    expect(e.groups.map((g) => g.policy).sort()).toEqual([0, 1, 2]);
    expect(e.lines.map((l) => [l.line, l.reportOnly, l.policy])).toEqual([
      ["connect-src 'self' https://*.google-analytics.com", false, POLICY],
      ["connect-src 'self' https://*.google-analytics.com", true, "connect-src 'self'"],
      ["connect-src 'self' https://old.example.com https://*.google-analytics.com", false, "connect-src 'self' https://old.example.com"],
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

  it("keeps what weakens the policy out of the lines and the fixed policy: a style attribute's 'unsafe-inline', eval", () => {
    const e = explainReports([report({ blockedURL: 'inline', effectiveDirective: 'style-src-attr' }), report({ blockedURL: 'eval', effectiveDirective: 'script-src' })].join('\n'), vendors);
    expect(e.lines).toEqual([]);
    expect(e.policies[0]!.fixed).toBeUndefined();
    expect(e.groups.map((g) => [g.explained.case, g.explained.weaker?.line])).toEqual([
      ['eval', "script-src 'self' 'nonce-abc' 'unsafe-eval'"],
      ['style-attr', "style-src-attr 'unsafe-inline'"],
    ]);
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
