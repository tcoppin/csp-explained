import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserOf, readReports, timeOf } from './violation-report';

/**
 * Reports sent by the browsers themselves (2026) to a test page's endpoint, addresses replaced with
 * www.example.com: an enforced and a report-only policy, each refusing an inline style, a style attribute, an image,
 * an inline script, eval, a fetch, a script and an event handler (16 reports per file).
 */
const dir = join(import.meta.dirname, 'violation-reports');
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8');

const ENFORCED = "default-src 'self'; script-src 'self' 'nonce-abc' 'report-sample'; style-src 'self' 'report-sample'; img-src 'self'; report-uri https://reports.example.com/csp";

describe('readReports', () => {
  it.each(readdirSync(dir))('reads every report in %s', (name) => {
    const { reports, skipped } = readReports(fixture(name));
    expect(reports).toHaveLength(16);
    expect(skipped).toBe(0);
    expect(new Set(reports.map((r) => r.directive))).toEqual(
      new Set(['style-src-elem', 'style-src-attr', 'img-src', 'script-src-elem', 'script-src', 'connect-src', 'script-src-attr']),
    );
    expect(reports.every((r) => r.page === 'https://www.example.com/page?utm_source=mail&email=someone%40example.com')).toBe(true);
  });

  it('reads the older format, with what was blocked, the rule, the policy and the sample', () => {
    const { reports } = readReports(fixture('chromium-report-uri.ndjson'));
    expect(reports[0]).toEqual({
      page: 'https://www.example.com/page?utm_source=mail&email=someone%40example.com',
      blocked: 'inline',
      directive: 'style-src-elem',
      policy: ENFORCED,
      disposition: 'enforce',
      sourceFile: 'https://www.example.com/page',
      sample: 'body{color:red}',
    });
    expect(reports.filter((r) => r.disposition === 'report')).toHaveLength(8);
  });

  it('reads the Reporting API format, with the browser beside the body', () => {
    const { reports } = readReports(fixture('firefox-reporting-api.json'));
    expect(reports[0]).toMatchObject({ blocked: 'inline', directive: 'style-src-elem', disposition: 'enforce', sample: 'body{color:red}' });
    expect(browserOf(reports[0]!.userAgent)).toBe('Firefox');
  });

  it("takes Safari's older reports, which don't say, as enforced, and says it guessed", () => {
    const { reports } = readReports(fixture('webkit-report-uri.ndjson'));
    expect(reports.every((r) => r.disposition === 'enforce' && r.guessed)).toBe(true);
  });

  it('learns whether a policy is report-only from another report under the same policy', () => {
    const report = (disposition?: string) => JSON.stringify({ 'csp-report': { 'blocked-uri': 'eval', 'effective-directive': 'script-src', 'original-policy': "script-src 'self'", ...(disposition ? { disposition } : {}) } });
    const { reports } = readReports(`${report('report')}\n${report()}`);
    expect(reports.map((r) => [r.disposition, r.guessed])).toEqual([['report', undefined], ['report', undefined]]);
  });

  it("reads Chromium's Reporting API reports, as documented, and leaves out other kinds of report", () => {
    const batch = [
      {
        age: 120,
        type: 'csp-violation',
        url: 'https://www.example.com/checkout?order=42',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        body: {
          documentURL: 'https://www.example.com/checkout?order=42',
          referrer: '',
          blockedURL: 'trusted-types-sink',
          effectiveDirective: 'require-trusted-types-for',
          originalPolicy: "require-trusted-types-for 'script'; report-to csp",
          disposition: 'report',
          sample: 'HTMLScriptElement src|https://cdn.example.net/a.js',
          statusCode: 200,
        },
      },
      { type: 'deprecation', url: 'https://www.example.com/', body: { id: 'X', message: 'Y' } },
    ];
    const { reports } = readReports(JSON.stringify(batch));
    expect(reports).toEqual([
      {
        page: 'https://www.example.com/checkout?order=42',
        blocked: 'trusted-types-sink',
        directive: 'require-trusted-types-for',
        policy: "require-trusted-types-for 'script'; report-to csp",
        disposition: 'report',
        sample: 'HTMLScriptElement src|https://cdn.example.net/a.js',
        userAgent: batch[0]!.user_agent,
      },
    ]);
  });

  it('reads log lines and collector wrappers, with the JSON after a prefix or held in a string', () => {
    const body = { 'csp-report': { 'blocked-uri': 'https://static.hotjar.com/c/hotjar-1.js', 'effective-directive': 'script-src-elem', 'document-uri': 'https://www.example.com/' } };
    const input = [
      `2026-11-20T10:00:00Z INFO csp ${JSON.stringify(body)}`,
      JSON.stringify({ timestamp: 1, userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', payload: JSON.stringify(body) }),
      'GET /health 200',
      '{"not": "a report"}',
    ].join('\n');
    const { reports, skipped } = readReports(input);
    expect(reports.map((r) => [r.blocked, browserOf(r.userAgent)])).toEqual([
      ['https://static.hotjar.com/c/hotjar-1.js', undefined],
      ['https://static.hotjar.com/c/hotjar-1.js', 'Safari'],
    ]);
    // The line without JSON isn't counted: it isn't something we failed to read.
    expect(skipped).toBe(1);
  });

  // Collector services don't publish their export formats: these are the spellings exports use, not one service's.
  it("reads a collector's own spelling of the fields, nested anywhere", () => {
    const event = {
      id: 'e1',
      dateCreated: '2026-11-20T10:00:00Z',
      csp: { blocked_uri: 'https://static.hotjar.com/c/hotjar-1.js', effective_directive: 'script-src-elem', document_uri: 'https://www.example.com/', disposition: 'enforce' },
      request: { headers: [['User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0']] },
    };
    const tagged = { tags: [{ key: 'blocked-uri', value: 'eval' }, { key: 'effective-directive', value: 'script-src' }, { key: 'disposition', value: 'report-only' }] };
    const { reports } = readReports(JSON.stringify([event, tagged]));
    expect(reports).toEqual([
      {
        blocked: 'https://static.hotjar.com/c/hotjar-1.js',
        directive: 'script-src-elem',
        page: 'https://www.example.com/',
        disposition: 'enforce',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',
        time: Date.UTC(2026, 10, 20, 10),
      },
      { blocked: 'eval', directive: 'script-src', disposition: 'report' },
    ]);
  });

  it("takes a report's browser from its own record, never from another one in the same file", () => {
    const withBrowser = {
      csp: { blocked_uri: 'https://static.hotjar.com/c/hotjar-1.js', effective_directive: 'script-src-elem' },
      request: { headers: [['User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0']] },
    };
    const without = { csp: { blocked_uri: 'eval', effective_directive: 'script-src' } };
    // An export that holds its records in one object: each record is still its own.
    const { reports } = readReports(JSON.stringify({ events: [withBrowser, without] }));
    expect(reports.map((r) => [r.blocked, browserOf(r.userAgent)])).toEqual([
      ['https://static.hotjar.com/c/hotjar-1.js', 'Firefox'],
      ['eval', undefined],
    ]);
  });

  it('reads a large export held in one object as fast as one report per line', () => {
    const record = (i: number) => ({ csp: { blocked_uri: `https://cdn${i % 30}.example/x.js`, effective_directive: 'script-src-elem', document_uri: `https://www.example.com/${i % 40}` } });
    const records = Array.from({ length: 50_000 }, (_, i) => record(i));
    const start = performance.now();
    expect(readReports(JSON.stringify({ events: records })).reports).toHaveLength(50_000);
    // Searching the whole file for each report's browser took minutes here.
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it("reads the shapes collectors document: Sentry's CSP interface, its csp-report output, and Datadog's logs", () => {
    // Sentry keeps document_uri, violated_directive, blocked_uri and effective_directive (src/sentry/interfaces/security.py)
    // and writes them back under "csp-report"; Datadog's intake keeps the browser's csp-report as sent.
    const sentry = { id: 'a1', csp: { document_uri: 'https://www.example.com/', violated_directive: 'script-src', blocked_uri: 'https://static.hotjar.com/c/hotjar-1.js', effective_directive: 'script-src-elem' } };
    const sentryOut = { 'csp-report': { document_uri: 'https://www.example.com/cart', violated_directive: 'connect-src', blocked_uri: 'https://region1.google-analytics.com', effective_directive: 'connect-src' } };
    const datadog = {
      date: '2026-11-20T10:00:00.000Z',
      service: 'shop',
      attributes: { ddsource: 'csp-report', 'csp-report': { 'blocked-uri': 'eval', 'document-uri': 'https://www.example.com/', 'violated-directive': 'script-src', 'original-policy': "script-src 'self'", disposition: 'enforce' } },
    };
    const { reports } = readReports([sentry, sentryOut, datadog].map((x) => JSON.stringify(x)).join('\n'));
    expect(reports.map((r) => [r.blocked, r.directive, r.page])).toEqual([
      ['https://static.hotjar.com/c/hotjar-1.js', 'script-src-elem', 'https://www.example.com/'],
      ['https://region1.google-analytics.com', 'connect-src', 'https://www.example.com/cart'],
      ['eval', 'script-src', 'https://www.example.com/'],
    ]);
    expect(reports[2]!.time).toBe(Date.UTC(2026, 10, 20, 10));
  });

  it('counts once a report a record keeps twice: as raw text, and as parsed fields', () => {
    const raw = { 'csp-report': { 'blocked-uri': 'eval', 'effective-directive': 'script-src', 'document-uri': 'https://www.example.com/' } };
    const record = {
      message: JSON.stringify(raw),
      '@csp-report.blocked-uri': 'eval',
      '@csp-report.effective-directive': 'script-src',
      '@csp-report.document-uri': 'https://www.example.com/',
      '@http.useragent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    };
    const { reports } = readReports([record, record].map((r) => JSON.stringify(r)).join('\n'));
    expect(reports.map((r) => [r.blocked, browserOf(r.userAgent)])).toEqual([
      ['eval', 'Chrome'],
      ['eval', 'Chrome'],
    ]);
  });

  it('reads a CSV or TSV export with a header row, quoted cells included', () => {
    const csv = [
      'Date,Blocked URI,Effective Directive,Document URI,Original Policy,Script Sample',
      `2026-11-20 10:00,https://static.hotjar.com/c/hotjar-1.js,script-src-elem,https://www.example.com/,"${ENFORCED}",`,
      '2026-11-20 10:01,inline,script-src-elem,https://www.example.com/,"default-src \'self\'","console.log(""hi, there"")\nlog()"',
      ',,,,,',
    ].join('\r\n');
    const { reports, skipped } = readReports(csv);
    expect(reports.map((r) => [r.blocked, r.directive, r.policy, r.sample])).toEqual([
      ['https://static.hotjar.com/c/hotjar-1.js', 'script-src-elem', ENFORCED, undefined],
      ['inline', 'script-src-elem', "default-src 'self'", 'console.log("hi, there")\nlog()'],
    ]);
    expect(skipped).toBe(0);

    const tsv = 'tags[blocked-uri]\ttags[violated-directive]\turl\nhttps://example.net/x.png\timg-src \'self\'\thttps://www.example.com/a\n';
    expect(readReports(tsv).reports).toEqual([{ blocked: 'https://example.net/x.png', directive: 'img-src', disposition: 'enforce', guessed: true }]);
  });

  it('reads a CSV export whose cell holds the whole report, and counts rows without one', () => {
    const report = JSON.stringify({ 'csp-report': { 'blocked-uri': 'eval', 'effective-directive': 'script-src' } }).replaceAll('"', '""');
    const csv = `Date,Host,Message\n2026-11-20,web-1,"${report}"\n2026-11-20,web-1,started\n`;
    expect(readReports(csv)).toMatchObject({ reports: [{ blocked: 'eval', directive: 'script-src' }], skipped: 1 });
  });

  it("keeps the date a collector kept: a field, a CSV column, or the start of a log line", () => {
    const body = { 'csp-report': { 'blocked-uri': 'eval', 'effective-directive': 'script-src' } };
    const lines = [
      `2026-11-20T10:00:00Z INFO csp ${JSON.stringify(body)}`,
      `[19/Nov/2026:08:30:00 +0000] ${JSON.stringify(body)}`,
      JSON.stringify({ '@timestamp': 1795000000, ...body }),
      JSON.stringify(body),
    ].join('\n');
    expect(readReports(lines).reports.map((r) => r.time)).toEqual([Date.UTC(2026, 10, 20, 10), Date.UTC(2026, 10, 19, 8, 30), 1795000000000, undefined]);
    const csv = 'timestamp,blocked-uri,effective-directive\n1795000000123,eval,script-src\n';
    expect(readReports(csv).reports[0]!.time).toBe(1795000000123);
  });

  it('reads times in seconds, milliseconds or as dates, and nothing that is only a number', () => {
    expect(timeOf('2026-11-20T10:00:00.5Z')).toBe(Date.UTC(2026, 10, 20, 10, 0, 0, 500));
    expect(timeOf('2026-11-20 10:00:00+01:00')).toBe(Date.UTC(2026, 10, 20, 9));
    expect(timeOf('1795000000')).toBe(1795000000000);
    expect(timeOf('1795000000000000')).toBe(1795000000000);
    expect(timeOf('3')).toBeUndefined();
    expect(timeOf('yesterday')).toBeUndefined();
  });

  it('reads a part of an array copied without its brackets', () => {
    const one = '{ "csp-report": { "blocked-uri": "eval", "violated-directive": "script-src \'self\'" } }';
    expect(readReports(`${one},\n${one},`).reports.map((r) => r.directive)).toEqual(['script-src', 'script-src']);
  });
});

describe('browserOf', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', 'Edge'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', 'Chrome'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0', 'Firefox'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', 'Safari'],
    [undefined, undefined],
  ])('%s is %s', (ua, name) => expect(browserOf(ua)).toBe(name));
});
