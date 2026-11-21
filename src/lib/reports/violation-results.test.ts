import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_REPORTS } from '../../components/violation-reports/example';
import { translator } from '../../i18n';
import { parseVendor } from '../catalogue/schema';
import { explainReports } from '../violation-reports';
import { cell, resultsCsv, resultsJson } from './violation-results';

const dir = join(import.meta.dirname, '../../../catalogue/vendors');
const vendors = readdirSync(dir).map((f) => parseVendor(readFileSync(join(dir, f), 'utf8')));
const t = translator('en');
const r = explainReports(EXAMPLE_REPORTS, vendors);
const meta = { source: 'The example', date: new Date(Date.UTC(2026, 10, 21)), pages: true, samples: false, policies: false };

describe('the results as data', () => {
  it('writes one CSV row per problem, riskiest first, then what is allowed, then what was set apart', () => {
    const lines = resultsCsv(r, t, meta).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Rank,Level,Problem,Blocked,Rule,Reports,Pages,Page list,Browsers,First,Last,Why,Tools,Safe fix');
    expect(lines).toHaveLength(1 + 7 + 4);
    expect(lines[1]).toMatch(/^1,Check first,A script from cdn\.jquery-libs\.example,https:\/\/cdn\.jquery-libs\.example\/jquery\.min\.js,script-src,5,2,\/checkout \(3\); \/cart \(2\),/);
    expect(lines[1]).toContain(',unknown; sensitive; enforced; code; new,');
    expect(lines[3]).toMatch(/^3,Then,A script from static\.hotjar\.com,.*,Hotjar,script-src https:\/\/static\.hotjar\.com$/);
    expect(lines[7]).toMatch(/^7,Allowed,A script from www\.googletagmanager\.com,/);
    expect(lines[8]).toMatch(/^8,Set apart: Browser extensions,A browser extension,/);
    // Without the pages, the column goes.
    expect(resultsCsv(r, t, { ...meta, pages: false }).split('\r\n')[0]).not.toContain('Page list');
  });

  it('never lets a cell run as a formula in a spreadsheet, and quotes what needs it', () => {
    expect(cell('=HYPERLINK("https://evil.example")')).toBe(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(cell('+1')).toBe("'+1");
    expect(cell('-2')).toBe("'-2");
    expect(cell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(cell('a, b')).toBe('"a, b"');
    expect(cell('plain')).toBe('plain');
  });

  it('writes JSON with stable keys: the problems, the lines, the verdicts, and only what was asked for', () => {
    const json = JSON.parse(resultsJson(r, t, meta));
    expect(json).toMatchObject({ generator: 'CSP Explained', exported: '2026-11-21T00:00:00.000Z', source: 'The example', site: 'https://shop.example.com', reports: { read: 138 } });
    expect(json.problems).toHaveLength(11);
    expect(json.problems[0]).toMatchObject({ rank: 1, status: 'high', host: 'cdn.jquery-libs.example', unknown: true, reports: 5, pageCount: 2, pages: [{ page: '/checkout', reports: 3 }, { page: '/cart', reports: 2 }] });
    expect(json.problems[0].reasons.map((x: { kind: string }) => x.kind)).toEqual(['unknown', 'sensitive', 'enforced', 'code', 'new']);
    expect(json.problems[0].reasons.at(-1).since).toMatch(/^2026-11-1\dT/);
    expect(json.problems[0].samples).toBeUndefined();
    expect(json.problems.find((p: { status: string; cause?: string }) => p.cause === 'software')).toMatchObject({ status: 'set-apart', host: 'gc.kis.v2.scr.kaspersky-labs.com' });
    expect(json.lines.map((l: { line: string }) => l.line)).toEqual([
      "script-src 'self' 'nonce-r4nd0m' https://www.googletagmanager.com https://static.hotjar.com",
      "connect-src 'self' https://*.google-analytics.com wss://*.hotjar.com",
    ]);
    expect(json.policies).toBeUndefined();
    // Asked for: what the reports quoted, and the policies.
    const full = JSON.parse(resultsJson(r, t, { ...meta, samples: true, policies: true }));
    expect(full.problems[0].sources).toEqual([{ file: 'https://shop.example.com/assets/theme.js', reports: 5 }]);
    expect(full.policies).toHaveLength(2);
  });
});
