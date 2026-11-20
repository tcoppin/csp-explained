/** The reports reader (/reports): reading a batch, what it shows and says, the comparator link, and what is counted. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openReader, announced, readAloud, watchErrors } from './helpers';

/** Chromium's own reports (report-uri format, one per line): 16 of them, from an enforced and a report-only policy. */
const CHROMIUM = readFileSync(join(import.meta.dirname, '../../src/lib/csp/violation-reports/chromium-report-uri.ndjson'), 'utf8');

// The example's dates, as a visitor in Paris reads them (the same days in most time zones).
test.use({ timezoneId: 'Europe/Paris' });

const box = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Paste your reports' });

test('the example groups the reports by problem, riskiest first, with the lines to change', async ({ page, sent }) => {
  const errors = watchErrors(page);
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('heading', { name: 'What the 138 reports say', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '6 problems, from your site', level: 3 })).toBeVisible();

  // Riskiest first, whatever the counts: the look-alike jQuery (5 reports), the checkout's inline script (4), then
  // the tools blocked everywhere, then a look.
  await expect(page.locator('.violation-list').first().locator('> .violation > h3')).toHaveText([
    'A script from cdn.jquery-libs.example',
    'A script written in the page',
    'A script from static.hotjar.com',
    'A connection to region1.google-analytics.com',
    'A connection to ws.hotjar.com',
    'A style attribute',
  ]);
  await expect(page.locator('.violation-list').first().locator('.report-risk')).toHaveText([
    'Check first: an address no known tool uses, on /checkout, where visitors pay or sign in, blocked for your visitors, it runs code or sends data, and new since Nov 17, 2026.',
    'Check first: on /checkout, where visitors pay or sign in, blocked for your visitors, and it runs code or sends data.',
    'Then: blocked for your visitors and it runs code or sends data.',
    'Then: blocked for your visitors and it runs code or sends data.',
    'Then: blocked for your visitors and it runs code or sends data.',
    'Less urgent: blocked for your visitors and it only changes how the page looks.',
  ]);
  const first = page.locator('.violation', { has: page.getByRole('heading', { name: 'A script from static.hotjar.com' }) });
  await expect(first.locator('.violation-status')).toHaveText('Blocked by script-src.');
  await expect(first.locator('.report-stats > p')).toHaveText('46 reports on 6 pages from Chrome, Edge, Safari, and Firefox. First on Nov 13, 2026, last on Nov 19, 2026.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/vendors/hotjar');
  // Page addresses without their query strings.
  await first.locator('.report-pages summary').click();
  await expect(first.locator('.report-pages')).toContainText('/blog/new-collection (7 reports)');
  await expect(first.locator('.report-pages')).not.toContainText('utm_source');

  // A rule created from default-src for the connections, never widening default-src.
  // Nothing that weakens the policy for everyone: no 'unsafe-inline' for the style attributes.
  await expect(page.locator('.violation-lines .code-block')).toHaveText([/script-src 'self' 'nonce-r4nd0m' https:\/\/www.googletagmanager.com https:\/\/static.hotjar.com/, /connect-src 'self' https:\/\/\*.google-analytics.com wss:\/\/\*.hotjar.com/]);

  // What the site didn't cause is folded at the end, one section per cause, and adds no line.
  await expect(page.locator('.report-results > p').first()).toContainText("17 reports weren't caused by your site: they are set apart at the end, by cause.");
  const noise = page.locator('.report-noise');
  await expect(noise.locator('> summary')).toHaveText([
    'Set apart: 2 problems from browser extensions (10 reports)',
    "Set apart: 1 problem from software on visitors' devices (4 reports)",
    'Set apart: 1 problem from translation (3 reports)',
  ]);
  await expect(noise.locator('.violation').first()).toBeHidden();
  const software = page.locator('.report-noise[data-noise=software]');
  await software.locator('> summary').click();
  await expect(software).toContainText('Antivirus software, programs that inject ads and company proxies');
  // Only what was blocked and the counts: no tool lookup, no line, no "check what it is".
  const kaspersky = software.locator('.violation');
  await expect(kaspersky.getByRole('heading')).toHaveText('A script from gc.kis.v2.scr.kaspersky-labs.com');
  await expect(kaspersky).toHaveClass(/elsewhere/);
  await expect(kaspersky).not.toContainText('No tool in the catalogue');
  await expect(kaspersky.locator('.code-block, .violation-weaker')).toHaveCount(0);

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

test('dated reports tell what an older policy blocked that the newest allows, and can be read from a day on', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('.report-period')).toContainText(/Received Nov 13\s*–\s*19, 2026\./);
  // The policy changed on the 15th: the older one is listed, and gets no lines of its own.
  await expect(page.locator('.report-policies summary').first()).toHaveText(/^Policy 1, an older version: \d+ reports, until Nov 14, 2026$/);
  await expect(page.getByRole('heading', { name: 'What to change in your policy' })).toBeVisible();
  // Google Tag Manager was only blocked by the older one: the change worked.
  const allowed = page.locator('.report-allowed');
  await expect(allowed.locator('> summary')).toHaveText('Already allowed by your newest policy: 1 problem (14 reports)');
  await allowed.locator('> summary').click();
  await expect(allowed.getByRole('heading', { name: 'A script from www.googletagmanager.com' })).toBeVisible();
  // What's new shows in its dates.
  const skimmer = page.locator('.violation', { has: page.getByRole('heading', { name: 'A script from cdn.jquery-libs.example' }) });
  await expect(skimmer.locator('.report-stats > p')).toContainText('On Nov 17, 2026.');

  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  const heard = await live(() => page.getByLabel('Only the reports since').fill('2026-11-17'));
  expect(heard.at(-1)).toMatch(/^polite: \d+ reports since Nov 17, 2026\.$/);
  await expect(page.locator('.report-period')).toContainText(/\d+ older reports left out\./);
  await expect(page.locator('.report-allowed')).toHaveCount(0);
  await expect(page.locator('.report-policies')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '6 problems, from your site' })).toBeVisible();

  // A day after the last report: nothing, said so, and the box stays to pick another.
  await page.getByLabel('Only the reports since').fill('2026-11-20');
  await expect(page.getByText('No report since that day.')).toBeVisible();
  await expect(page.getByLabel('Only the reports since')).toBeVisible();
});

test('the whole policy with the changes opens in the comparator', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('link', { name: 'See the whole policy with these changes, in the comparator' }).click();
  await expect(page).toHaveURL(/\/compare#b=/);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page.getByRole('textbox', { name: 'Before' })).toHaveValue(/report-to csp$/);
  await expect(page.getByRole('textbox', { name: 'After' })).toHaveValue(/connect-src 'self' https:\/\/\*\.google-analytics\.com wss:\/\/\*\.hotjar\.com$/);
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
  expect(await live(() => page.getByRole('button', { name: 'Try an example' }).click())).toEqual(['polite: 138 reports read.']);
  // The colour of the block says "blocked"; the words say it too, with the counts.
  const heard = (await readAloud(page, '.violation:nth-child(4)')).join(' ');
  expect(heard).toContain('heading, A connection to region1.google-analytics.com, level 3');
  // How urgent it is, in words, right under what happened.
  expect(heard).toMatch(/Then end of strong : blocked for your visitors and it runs code or sends data|Then: blocked for your visitors/);
  expect(heard).toMatch(/Blocked by (?:code )?default-src/);
  expect(heard).toContain('31 reports on 6 pages from');
  expect(heard).toMatch(/Your policy has no (?:code )?connect-src|line above allows it/);
});

test("inline code gets the safe way first; 'unsafe-inline' only when asked, with what it costs before the line", async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  const attr = page.locator('.violation', { has: page.getByRole('heading', { name: 'A style attribute' }) });
  await expect(attr).toContainText('The safest way is to move these styles into your stylesheet, as classes');
  const fold = attr.locator('.violation-weaker');
  await expect(fold.locator('.code-block')).toBeHidden();
  await fold.getByText('A quicker way, less safe').click();
  await expect(fold.locator('.violation-risk')).toContainText('This lets every style attribute apply, including one an attacker slips in');
  await expect(fold.locator('figcaption > span')).toHaveText('If you accept that, add this rule to your policy');
  await expect(fold.locator('pre')).toHaveText("style-src-attr 'unsafe-inline'");
  // Heard in that order: the safe way, the fold, what it costs, then the line.
  const heard = (await readAloud(page, '.violation:has(.violation-weaker)')).join(' ');
  expect(heard).toMatch(/The safest way.*A quicker way, less safe.*This lets every (?:code )?style.*style-src-attr 'unsafe-inline'/);
  // The checkout's inline script, under a rule with a nonce: 'unsafe-inline' would be ignored, so it isn't offered.
  const inline = page.locator('.violation', { has: page.getByRole('heading', { name: 'A script written in the page' }) });
  await expect(inline).toContainText("Your script-src rule has a nonce or a hash, so browsers ignore 'unsafe-inline' there");
  await expect(inline.locator('.violation-weaker')).toHaveCount(0);
});

test('reports are read in French on French pages', async ({ page }) => {
  await openReader(page, '/fr/reports');
  await page.getByRole('button', { name: 'Essayer un exemple' }).click();
  await expect(page.getByRole('heading', { name: 'Ce que disent les 138 rapports' })).toBeVisible();
  await expect(page.locator('.report-risk').first()).toHaveText(/^À voir en premier : une adresse qu'aucun outil connu n'utilise, sur \/checkout, où les visiteurs paient ou se connectent,/);
  const first = page.locator('.violation', { has: page.getByRole('heading', { name: 'Un script de static.hotjar.com' }) });
  await expect(first.locator('.violation-status')).toHaveText('Bloqué par script-src.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/fr/vendors/hotjar');
  await expect(first.locator('.report-stats > p')).toHaveText(/^46 rapports sur 6 pages depuis Chrome, Edge, Safari et Firefox\. Premier le 13 nov\. 2026, dernier le 19 nov\. 2026\.$/);
});
