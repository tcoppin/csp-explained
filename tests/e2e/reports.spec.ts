/** The reports reader (/reports): reading a batch, what it shows and says, the comparator link, and what is counted. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openReader, announced, readAloud, watchErrors } from './helpers';

/** Chromium's own reports (report-uri format, one per line): 16 of them, from an enforced and a report-only policy. */
const CHROMIUM = readFileSync(join(import.meta.dirname, '../../src/lib/csp/violation-reports/chromium-report-uri.ndjson'), 'utf8');

const box = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Paste your reports' });

test('the example groups the reports by problem, most reports first, with the lines to change', async ({ page, sent }) => {
  const errors = watchErrors(page);
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('heading', { name: 'What the 117 reports say', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '6 problems, from your site', level: 3 })).toBeVisible();

  const first = page.locator('.violation').first();
  await expect(first.getByRole('heading', { level: 3 })).toHaveText('A script from static.hotjar.com');
  await expect(first.locator('.violation-status')).toHaveText('Blocked by script-src.');
  await expect(first.locator('.report-stats > p')).toHaveText('46 reports on 6 pages from Chrome, Edge, Safari, and Firefox.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/vendors/hotjar');
  // Page addresses without their query strings.
  await first.locator('.report-pages summary').click();
  await expect(first.locator('.report-pages')).toContainText('/blog/new-collection (7 reports)');
  await expect(first.locator('.report-pages')).not.toContainText('utm_source');

  // A rule created from default-src for the connections, never widening default-src.
  await expect(page.locator('.violation-lines .code-block')).toHaveText([/style-src-attr 'unsafe-inline'/, /script-src 'self' 'nonce-r4nd0m' https:\/\/www.googletagmanager.com https:\/\/static.hotjar.com/, /connect-src 'self' https:\/\/\*.google-analytics.com wss:\/\/\*.hotjar.com/]);

  // What extensions caused is folded at the end, and adds no line.
  const noise = page.locator('.report-noise');
  await expect(noise.locator('> summary')).toHaveText('Set apart: 2 problems from browser extensions (10 reports)');
  await expect(noise.locator('.violation').first()).toBeHidden();

  // The example isn't counted as reports read.
  expect(sent().filter((q) => q.startsWith('n=read-reports'))).toEqual([]);
  expect(sent()).toContain('n=example');
  expect(errors).toEqual([]);
});

test("an address no tool uses stays out of the lines until the visitor says they know it", async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('.report-results > p').first()).toContainText("1 address we don't know is left out of the lines until you check it.");
  const skimmer = page.locator('.violation', { has: page.getByRole('heading', { name: 'A script from cdn.jquery-libs.example' }) });
  await expect(skimmer.locator('.violation-risk')).toContainText('search your site\'s code and your tag manager for cdn.jquery-libs.example');
  const script = page.locator('.violation-lines .code-block', { hasText: 'script-src' });
  await expect(script).not.toContainText('jquery-libs');

  // Said in words, not only by the warning's border; the change to the lines is announced.
  const heard = (await readAloud(page, '.violation:has(.report-trust)')).join(' ');
  expect(heard).toContain("No tool in the catalogue uses this address, and it isn't on your site's domain.");
  expect(heard).toContain("checkbox, I know what this is: allow it in the lines, not checked");
  const box = skimmer.getByRole('checkbox', { name: 'I know what this is: allow it in the lines' });
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  expect(await live(() => box.check())).toContain('polite: cdn.jquery-libs.example added to the lines.');
  await expect(box).toBeFocused();
  await expect(script).toContainText('https://cdn.jquery-libs.example');
  await expect(skimmer).toContainText('The script-src line above allows it.');
  await expect(skimmer.locator('.violation-risk')).toHaveCount(0);

  expect(await live(() => box.uncheck())).toContain('polite: cdn.jquery-libs.example taken out of the lines.');
  await expect(script).not.toContainText('jquery-libs');
});

test('the whole policy with the changes opens in the comparator', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('link', { name: 'See the whole policy with these changes, in the comparator' }).click();
  await expect(page).toHaveURL(/\/compare#b=/);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(/report-to csp$/);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(/connect-src 'self' https:\/\/\*\.google-analytics\.com wss:\/\/\*\.hotjar\.com; style-src-attr 'unsafe-inline'$/);
});

test('pasted reports are read, counted once without what they hold, and kept nowhere', async ({ page, sent }) => {
  await openReader(page);
  await box(page).fill(CHROMIUM);
  await expect(page.getByRole('heading', { name: 'What the 16 reports say' })).toBeVisible();
  // An enforced and a report-only policy: each with its own lines.
  await expect(page.getByRole('heading', { name: 'The 2 policies in these reports' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to change in policy 2' })).toBeVisible();
  await expect(page.locator('.violation.reported').first().locator('.violation-status')).toContainText('Not blocked: your report-only policy reported it');

  await expect.poll(() => sent().filter((q) => q.startsWith('n=read-reports'))).toEqual(['n=read-reports&from=paste']);
  expect(sent().join(' ')).not.toContain('example.com');
  expect(page.url()).not.toContain('#');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('a file is opened, not shown in the box, and Clear gives the box back with the focus', async ({ page, sent }) => {
  await openReader(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'csp-reports.ndjson', mimeType: 'application/x-ndjson', buffer: Buffer.from(CHROMIUM) });
  await expect(page.locator('.report-file')).toHaveText(/^csp-reports\.ndjson \([\d.]+ kB\) is open\.$/);
  await expect(box(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What the 16 reports say' })).toBeVisible();
  await expect.poll(() => sent().filter((q) => q.startsWith('n=read-reports'))).toEqual(['n=read-reports&from=file']);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(box(page)).toBeFocused();
  await expect(page.locator('.report-results')).toHaveCount(0);
});

test("a collector's CSV export is read by its column names", async ({ page }) => {
  await openReader(page);
  const csv = [
    'Date,Blocked URI,Effective Directive,Document URI,Original Policy',
    `2026-11-20 10:00,https://static.hotjar.com/c/hotjar-1.js,script-src-elem,https://www.example.com/,"default-src 'self'"`,
    `2026-11-20 10:05,https://static.hotjar.com/c/hotjar-1.js,script-src-elem,https://www.example.com/cart,"default-src 'self'"`,
  ].join('\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('heading', { name: 'What the 2 reports say' })).toBeVisible();
  await expect(page.locator('.violation').first().getByRole('heading', { level: 3 })).toHaveText('A script from static.hotjar.com');
  await expect(page.locator('.violation-lines .code-block')).toHaveText([/script-src 'self' https:\/\/static\.hotjar\.com/]);
});

test('text without reports says what a report looks like', async ({ page }) => {
  await openReader(page);
  await box(page).fill("default-src 'self'");
  await expect(page.locator('.report-none')).toContainText('No CSP violation report found in this text.');
});

test('a screen reader hears how many reports were read, and for each problem what happened and how often', async ({ page }) => {
  await openReader(page);
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  expect(await live(() => page.getByRole('button', { name: 'Try an example' }).click())).toEqual(['polite: 117 reports read.']);
  // The colour of the block says "blocked"; the words say it too, with the counts.
  const heard = (await readAloud(page, '.violation:nth-child(2)')).join(' ');
  expect(heard).toContain('heading, A connection to region1.google-analytics.com, level 3');
  expect(heard).toMatch(/Blocked by (?:code )?default-src/);
  expect(heard).toContain('31 reports on 6 pages from');
  expect(heard).toMatch(/Your policy has no (?:code )?connect-src|line above allows it/);
});

test('reports are read in French on French pages', async ({ page }) => {
  await openReader(page, '/fr/reports');
  await page.getByRole('button', { name: 'Essayer un exemple' }).click();
  await expect(page.getByRole('heading', { name: 'Ce que disent les 117 rapports' })).toBeVisible();
  const first = page.locator('.violation').first();
  await expect(first.locator('.violation-status')).toHaveText('Bloqué par script-src.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/fr/vendors/hotjar');
  await expect(first.locator('.report-stats > p')).toHaveText(/^46 rapports sur 6 pages depuis Chrome, Edge, Safari et Firefox\.$/);
});
