/** The reports reader (/reports): reading a batch, what it shows and says, the comparator link, and what is counted. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openReader, announced, readAloud, watchErrors, stubPrint, printed } from './helpers';

/** Chromium's own reports (report-uri format, one per line): 16 of them, from an enforced and a report-only policy. */
const CHROMIUM = readFileSync(join(import.meta.dirname, '../../src/lib/csp/violation-reports/chromium-report-uri.ndjson'), 'utf8');

// The example's dates, as a visitor in Paris reads them (the same days in most time zones).
test.use({ timezoneId: 'Europe/Paris' });

const box = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Paste your reports' });
/** A problem's row, by what was blocked; `open` unfolds it. */
const row = (page: import('@playwright/test').Page, what: string) => page.locator('.report-row', { has: page.locator('.report-row-what', { hasText: what }) });
const open = async (r: import('@playwright/test').Locator) => {
  await r.locator('> details > summary').click();
  await expect(r.locator('> details')).toHaveAttribute('open', '');
};

test('the example groups the reports by problem, riskiest first, with the lines to change', async ({ page, sent }) => {
  const errors = watchErrors(page);
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('heading', { name: 'What the 138 reports say', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '7 problems, from your site', level: 3 })).toBeVisible();

  // Read, the box folds into a bar, and the introduction goes: the results start near the top.
  await expect(page.locator('.report-bar')).toContainText('The example: 138 reports');
  await expect(box(page)).toHaveCount(0);
  await expect(page.locator('.lead')).toBeHidden();
  // The summary: each count highlighted like the rows' levels.
  await expect(page.locator('.report-summary')).toHaveText('From your site: 2 to check first, 3 to look at next, 1 less urgent, and 1 allowed since a policy change.');
  await expect(page.locator('.report-summary .report-level')).toHaveClass([/high/, /medium/, /low/, /fixed/]);

  // One row each, riskiest first whatever the counts: the look-alike jQuery (5 reports), the checkout's inline script
  // (4), then the tools blocked everywhere, then a look. All folded.
  await expect(page.locator('.report-row-what')).toHaveText([
    'A script from cdn.jquery-libs.example',
    'A script written in the page',
    'A script from static.hotjar.com',
    'A connection to region1.google-analytics.com',
    'A connection to ws.hotjar.com',
    'A style attribute',
    'A script from www.googletagmanager.com',
  ]);
  await expect(page.locator('.report-row-level')).toHaveText(['Check first', 'Check first', 'Then', 'Then', 'Then', 'Less urgent', 'Allowed']);
  await expect(page.locator('.report-row-meta')).toHaveText(['5 reports', '4 reports', '46 reports', '31 reports', '12 reports', '9 reports', 'since Nov 14, 2026, 14 reports']);
  await expect(page.locator('.report-row .violation').first()).toBeHidden();
  // Opened: why it ranks there, when something sets it apart.
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  await expect(skimmer.locator('.report-risk')).toHaveText('Why it ranks here: an address no known tool uses, on /checkout, where visitors pay or sign in, and new since Nov 17, 2026.');
  const first = row(page, 'static.hotjar.com');
  await open(first);
  await expect(first.locator('.report-risk')).toHaveCount(0);
  await expect(first.locator('.violation-status')).toHaveText('Blocked by script-src.');
  // The lines come after the problems.
  await expect(first).toContainText('The script-src line below allows it.');
  await expect(first.locator('.report-stats > p')).toHaveText('46 reports on 6 pages from Chrome, Edge, Safari, and Firefox. First on Nov 13, 2026, last on Nov 19, 2026.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/vendors/hotjar');
  // Page addresses without their query strings.
  await first.locator('.report-pages summary').click();
  await expect(first.locator('.report-pages')).toContainText('/blog/new-collection (7 reports)');
  await expect(first.locator('.report-pages')).not.toContainText('utm_source');

  // A rule created from default-src for the connections, never widening default-src.
  // Nothing that weakens the policy for everyone: no 'unsafe-inline' for the style attributes.
  await expect(page.locator('.violation-lines .code-block')).toHaveText([/script-src 'self' 'nonce-r4nd0m' https:\/\/www.googletagmanager.com https:\/\/static.hotjar.com/, /connect-src 'self' https:\/\/\*.google-analytics.com wss:\/\/\*.hotjar.com/]);

  // What the site didn't cause is one fold at the end, a part per cause, and adds no line.
  await expect(page.locator('.report-results > p.muted').first()).toHaveText("17 reports weren't caused by your site: they are set apart at the end, by cause.");
  const noise = page.locator('.report-noise');
  await expect(noise.locator('> summary')).toHaveText("Set apart: 17 reports your site didn't cause");
  await expect(noise.locator('.violation').first()).toBeHidden();
  await noise.locator('> summary').click();
  await expect(noise.locator('.report-noise-name')).toHaveText(['Browser extensions (10 reports)', "Software on visitors' devices (4 reports)", 'Translation (3 reports)']);
  const software = page.locator('.report-noise-cause[data-noise=software]');
  await expect(software).toContainText('Antivirus software, programs that inject ads and company proxies');
  // Formatted: no backticks left in the text.
  await expect(page.locator('.report-noise-cause[data-noise=translation] > p code')).toHaveText('translate.goog');
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
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  await expect(skimmer.locator('.violation-risk')).toContainText('search your site\'s code and your tag manager for cdn.jquery-libs.example');
  const script = page.locator('.violation-lines .code-block', { hasText: 'script-src' });
  await expect(script).not.toContainText('jquery-libs');

  // Said in words, not only by the warning's border; the change to the lines is announced.
  const heard = (await readAloud(page, '.report-row:has(.report-trust)')).join(' ');
  expect(heard).toContain("No tool in the catalogue uses this address, and it isn't on your site's domain.");
  expect(heard).toContain("checkbox, I know what this is: allow it in the lines, not checked");
  const box = skimmer.getByRole('checkbox', { name: 'I know what this is: allow it in the lines' });
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  expect(await live(() => box.check())).toContain('polite: cdn.jquery-libs.example added to the lines.');
  await expect(box).toBeFocused();
  await expect(script).toContainText('https://cdn.jquery-libs.example');
  await expect(skimmer).toContainText('The script-src line below allows it.');
  await expect(skimmer.locator('.violation-risk')).toHaveCount(0);

  expect(await live(() => box.uncheck())).toContain('polite: cdn.jquery-libs.example taken out of the lines.');
  await expect(script).not.toContainText('jquery-libs');
});

test("a domain the visitor says is theirs takes every address on it out of the unknown, said and undone the same way", async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  const mine = skimmer.getByRole('checkbox', { name: 'jquery-libs.example is one of my domains' });
  await expect(mine).not.toBeChecked();
  const script = page.locator('.violation-lines .code-block', { hasText: 'script-src' });
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  expect(await live(() => mine.check())).toContain('polite: jquery-libs.example counted as one of your domains: its addresses are in the lines.');
  // Its row may move; the focus stays on the box.
  await expect(mine).toBeFocused();
  await expect(script).toContainText('https://cdn.jquery-libs.example');
  // No longer unknown: no warning, no "I know what this is", and the reason it ranked first goes.
  await expect(skimmer.locator('.violation-risk')).toHaveCount(0);
  await expect(skimmer.getByRole('checkbox', { name: 'I know what this is: allow it in the lines' })).toHaveCount(0);
  await expect(skimmer.locator('.report-risk')).not.toContainText('no known tool');

  expect(await live(() => mine.uncheck())).toContain('polite: jquery-libs.example no longer counted as one of your domains.');
  await expect(mine).toBeFocused();
  await expect(script).not.toContainText('jquery-libs');
  await expect(skimmer.locator('.violation-risk')).toBeVisible();
});

test('a problem shows what the reports quoted, folded: the start of the code, the script that asked for it', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  // The look-alike jQuery: loaded by the theme's own script, without its query string.
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  const quoted = skimmer.locator('.report-quotes');
  await expect(quoted.locator('> summary')).toHaveText('What the reports quoted (1)');
  await expect(quoted.locator('.report-quotes-list')).toBeHidden();
  await quoted.locator('> summary').click();
  await expect(quoted).toContainText('The script that was running when it happened:');
  await expect(quoted.locator('.report-quotes-list code')).toHaveText(['https://shop.example.com/assets/theme.js']);
  // The checkout's inline script: the start of its code.
  const inline = row(page, 'A script written in the page');
  await open(inline);
  await inline.locator('.report-quotes > summary').click();
  await expect(inline.locator('.report-quotes-list').first()).toHaveText('window.dataLayer = window.dataLayer || [ (4 reports)');

  // No sample, under a rule that doesn't ask for one: how to get it next time.
  await page.locator('.report-bar').getByRole('button', { name: 'Clear' }).click();
  await box(page).fill(JSON.stringify({ 'csp-report': { 'document-uri': 'https://shop.example.com/', 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem', 'original-policy': "script-src 'self'" } }));
  const lone = page.locator('.report-row').first();
  await open(lone);
  await expect(lone.locator('.report-quotes-none')).toHaveText("These reports don't quote the blocked code: add 'report-sample' to your script-src rule, and the next ones will show its first 40 characters, enough to tell your own code from code slipped in.");
});

test('dated reports tell what an older policy blocked that the newest allows, and can be read from a day on', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('.report-period')).toContainText(/Received Nov 13\s*–\s*19, 2026\./);
  // The policy changed on the 15th: the older one is listed, and gets no lines of its own.
  await expect(page.locator('.report-policies li summary').first()).toHaveText(/^Policy 1, an older version: \d+ reports, until Nov 14, 2026$/);
  // The lines say which policy they're built on: the newest in the reports, from its first report.
  await expect(page.getByRole('heading', { name: 'What to change in the policy sent from Nov 14, 2026' })).toBeVisible();
  // Google Tag Manager was only blocked by the older one: the change worked.
  // Last in the list, allowed since the newer policy started coming (not "fixed": the reports can't say it's still
  // the one sent), with a green edge and the words for it.
  const gtm = row(page, 'www.googletagmanager.com');
  await expect(page.locator('.report-row').last()).toHaveClass(/fixed/);
  await expect(gtm.locator('.report-row-level')).toHaveText('Allowed');
  await expect(gtm.locator('.report-row-meta')).toHaveText('since Nov 14, 2026, 14 reports');
  await expect(gtm.locator('> details > summary')).toHaveAccessibleName('Allowed A script from www.googletagmanager.com since Nov 14, 2026, 14 reports');
  await open(gtm);
  await expect(gtm.locator('.report-risk')).toHaveText(/^The policy your pages sent from Nov 14, 2026 allows it, and no report about it came after that\. If it's still the policy your site sends, there's nothing to do\./);
  await expect(gtm.locator('.code-block')).toHaveCount(0);
  await expect(gtm.locator('.violation-status')).toHaveText('Blocked by script-src until Nov 14, 2026.');
  // What's new shows in its dates.
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  await expect(skimmer.locator('.report-stats > p')).toContainText('On Nov 17, 2026.');

  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  const heard = await live(() => page.getByLabel('Only the reports since').fill('2026-11-17'));
  expect(heard.at(-1)).toMatch(/^polite: \d+ reports since Nov 17, 2026\.$/);
  await expect(page.locator('.report-period')).toContainText(/\d+ older reports left out\./);
  await expect(page.locator('.report-row.fixed')).toHaveCount(0);
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
  await expect(page.locator('.report-policies > summary')).toHaveText('The 2 policies in these reports');
  await expect(page.getByRole('heading', { name: 'What to change in policy 2' })).toBeVisible();
  // The row's edge says "only reported"; opened, the words say it.
  const reported = page.locator('.report-row.reported').first();
  await open(reported);
  await expect(reported.locator('.violation-status')).toContainText('Not blocked: your report-only policy reported it');

  await expect.poll(() => sent().filter((q) => q.startsWith('n=read-reports'))).toEqual(['n=read-reports&from=paste']);
  expect(sent().join(' ')).not.toContain('example.com');
  expect(page.url()).not.toContain('#');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('a file is opened, not shown in the box, and Clear gives the box back with the focus', async ({ page, sent }) => {
  await openReader(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'csp-reports.ndjson', mimeType: 'application/x-ndjson', buffer: Buffer.from(CHROMIUM) });
  await expect(page.locator('.report-bar p')).toHaveText('csp-reports.ndjson: 16 reports');
  await expect(box(page)).toHaveCount(0);
  // "Change" shows the file's name and size, not its text.
  await page.locator('.report-bar').getByRole('button', { name: 'Change' }).click();
  await expect(page.locator('.report-file')).toHaveText(/^csp-reports\.ndjson \([\d.]+ kB\) is open\.$/);
  await expect(page.getByRole('button', { name: 'Open a file' })).toBeFocused();
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
  await expect(page.locator('.report-row-what')).toHaveText(['A script from static.hotjar.com']);
  await expect(page.locator('.violation-lines .code-block')).toHaveText([/script-src 'self' https:\/\/static\.hotjar\.com/]);
});

test('read, the box folds into a bar; Change unfolds it and Done folds it again, the focus following', async ({ page }) => {
  await openReader(page);
  // "Try an example" goes away with the box: the focus goes to the results' heading.
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('heading', { name: 'What the 138 reports say' })).toBeFocused();
  const bar = page.locator('.report-bar');
  await bar.getByRole('button', { name: 'Change' }).click();
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue(/csp-violation/);
  await expect(page.locator('.lead')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'What the 138 reports say' })).toBeFocused();
  await expect(bar).toBeVisible();

  // A paste into the empty box is a whole batch: folded at once. Typing isn't: the box stays.
  await bar.getByRole('button', { name: 'Clear' }).click();
  await expect(box(page)).toBeFocused();
  await box(page).evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, CHROMIUM);
  await expect(bar).toContainText('Pasted reports: 16 reports');
  await expect(page.getByRole('heading', { name: 'What the 16 reports say' })).toBeFocused();
  await bar.getByRole('button', { name: 'Clear' }).click();
  await box(page).fill(CHROMIUM);
  await expect(page.getByRole('heading', { name: 'What the 16 reports say' })).toBeVisible();
  await expect(box(page)).toBeFocused();
  await expect(bar).toHaveCount(0);
});

test('the results save as PDF, .html and Markdown, with what the visitor chose, and never the reports themselves', async ({ page, sent }) => {
  const errors = watchErrors(page);
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  const title = await page.title();
  // At the end of the results: the pages in, the policies out, by default.
  const save = page.getByRole('group', { name: 'Save a copy' });
  await expect(save.getByRole('checkbox', { name: 'Include the pages of each problem' })).toBeChecked();
  await expect(save.getByRole('checkbox', { name: 'Include the policies in the reports' })).not.toBeChecked();

  await stubPrint(page);
  await save.getByRole('button', { name: 'Print or save as PDF' }).click();
  const doc = (await printed(page))!;
  expect(doc.printing).toBe(true);
  expect(doc.title).toBe('Violation reports – shop.example.com');
  expect(doc.text).toContain('From your site: 2 to check first, 3 to look at next, 1 less urgent, and 1 allowed since a policy change.');
  expect(doc.text).toMatch(/Check first\s*: A script from cdn\.jquery-libs\.example/);
  expect(doc.text).toContain('Pages: /checkout (3 reports) and /cart (2 reports).');
  // Unfolded and on paper: the warnings, the quicker way as a note, no box to fill in.
  expect(doc.text).toContain('search your site\'s code and your tag manager for cdn.jquery-libs.example');
  expect(doc.text).toContain("A quicker way, less safe: Add a style-src-attr rule");
  expect(doc.text).toContain('get the hash from the code itself');
  expect(doc.text).toContain("script-src 'self' 'nonce-r4nd0m' https://www.googletagmanager.com https://static.hotjar.com");
  expect(doc.text).toContain("Set apart: 17 reports your site didn't cause");
  // Never the reports: no browser string, no raw field.
  expect(doc.text).not.toMatch(/Mozilla|blockedURL|csp-violation/);
  expect(doc.text).not.toContain('The 2 policies in these reports');
  // What the reports quoted stays out unless asked for: a sample can hold data.
  await expect(save.getByRole('checkbox', { name: 'Include what the reports quoted of the code' })).not.toBeChecked();
  expect(doc.text).not.toContain('window.dataLayer');
  await expect.poll(sent).toContain('n=export-reports&format=pdf');
  // The print window closed: the page as it was, the focus still on the button.
  await expect(page.locator('.print-host')).toHaveCount(0);
  await expect(save.getByRole('button', { name: 'Print or save as PDF' })).toBeFocused();
  expect(await page.title()).toBe(title);

  // Without the pages, with the policies: a standalone .html file whose links point to the site.
  await save.getByRole('checkbox', { name: 'Include the pages of each problem' }).uncheck();
  await save.getByRole('checkbox', { name: 'Include the policies in the reports' }).check();
  await save.getByRole('checkbox', { name: 'Include what the reports quoted of the code' }).check();
  const [html] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .html' }).click()]);
  expect(html.suggestedFilename()).toMatch(/^csp-violation-reports-\d{4}-\d{2}-\d{2}\.html$/);
  const file = readFileSync((await html.path())!, 'utf8');
  expect(file).toMatch(/^<!doctype html>\n<html lang="en">/);
  expect(file).toMatch(/<style>[^<]*\.report-doc \{[^<]*\.reports-doc \{/);
  expect(file).not.toContain('Pages: /');
  expect(file).toContain('The 2 policies in these reports');
  expect(file).toContain('window.dataLayer = window.dataLayer || [');
  expect(file).toContain('https://shop.example.com/assets/theme.js');
  expect(file).toContain('href="https://csp-explained.com/vendors/hotjar"');
  const opened = await page.context().newPage();
  await opened.setContent(file);
  await expect(opened.getByRole('heading', { level: 1 })).toHaveText('Violation reports');
  await expect(opened.getByRole('heading', { name: '7 problems, from your site' })).toBeVisible();
  await opened.close();

  // Markdown: the same document, as a file and copied.
  const [md] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .md' }).click()]);
  expect(md.suggestedFilename()).toMatch(/^csp-violation-reports-\d{4}-\d{2}-\d{2}\.md$/);
  const markdown = readFileSync((await md.path())!, 'utf8');
  expect(markdown).toMatch(/^\[CSP Explained\]\(https:\/\/csp-explained\.com\/\)\n\n# Violation reports\n/);
  expect(markdown).toContain('1. ### Check first: A script from cdn.jquery-libs.example');
  expect(markdown).toContain('This address is used by [Hotjar](https://csp-explained.com/vendors/hotjar): Tracking code.');
  expect(markdown).toContain("```\nscript-src 'self' 'nonce-r4nd0m' https://www.googletagmanager.com https://static.hotjar.com\n```");
  await save.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(save.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
  // For a spreadsheet or a tracker: one row or record per problem, with what was asked for.
  const [csv] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .csv' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^csp-violation-reports-\d{4}-\d{2}-\d{2}\.csv$/);
  const rows = readFileSync((await csv.path())!, 'utf8').trimEnd().split('\r\n');
  expect(rows[0]).toBe('Rank,Level,Problem,Blocked,Rule,Reports,Pages,Browsers,First,Last,Why,Tools,Safe fix,Quoted code,Running script');
  expect(rows[1]).toMatch(/^1,Check first,A script from cdn\.jquery-libs\.example,/);
  const [json] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .json' }).click()]);
  const data = JSON.parse(readFileSync((await json.path())!, 'utf8'));
  expect(data.problems[0]).toMatchObject({ rank: 1, status: 'high', host: 'cdn.jquery-libs.example', sources: [{ file: 'https://shop.example.com/assets/theme.js', reports: 5 }] });
  expect(data.policies).toHaveLength(2);
  expect(sent()).toEqual(expect.arrayContaining(['n=export-reports&format=html', 'n=export-reports&format=md', 'n=export-reports&format=copy', 'n=export-reports&format=csv', 'n=export-reports&format=json']));
  // What was counted: the format only.
  for (const q of sent().filter((q) => q.startsWith('n=export-reports'))) expect(q).toMatch(/^n=export-reports&format=(pdf|html|md|copy|csv|json)$/);
  expect(errors).toEqual([]);
});

test('a saved copy says what shaped it: the day picked, the addresses marked as known', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByLabel('Only the reports since').fill('2026-11-17');
  const skimmer = row(page, 'cdn.jquery-libs.example');
  await open(skimmer);
  await skimmer.getByRole('checkbox', { name: 'I know what this is: allow it in the lines' }).check();
  await stubPrint(page);
  await page.getByRole('button', { name: 'Print or save as PDF' }).click();
  const doc = (await printed(page))!;
  expect(doc.text).toMatch(/\d+ reports since Nov 17, 2026\./);
  expect(doc.text).toContain('1 address no known tool uses was marked as known, and is in the lines.');
  // Vouched for: its warning isn't in the copy, its address is in the lines.
  expect(doc.text).not.toContain('search your site\'s code and your tag manager');
  expect(doc.text).toContain('https://cdn.jquery-libs.example');
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
  // Each row says what, how urgent and how often: the level is in words, not only in the order.
  const summaries = page.locator('.report-row > details > summary');
  await expect(summaries.first()).toHaveAccessibleName('Check first A script from cdn.jquery-libs.example 5 reports');
  await expect(summaries.nth(5)).toHaveAccessibleName('Less urgent A style attribute 9 reports');
  // The summary's highlights are words too.
  const summary0 = (await readAloud(page, '.report-summary')).join(' ');
  expect(summary0).toMatch(/From your site:.*2 to check first.*3 to look at next.*1 less urgent.*1 allowed since a policy change/);
  // Its arrow is drawn, not read: the native fold says collapsed or expanded.
  const summary = page.locator('.report-row:nth-child(4) > details > summary');
  await expect(summary).toHaveCSS('display', 'flex');
  expect(await summary.evaluate((e) => getComputedStyle(e, '::before').content)).toBe('""');
  // Opened: the colour of its edge says "blocked"; the words say it too, with the counts.
  await summary.click();
  const heard = (await readAloud(page, '.report-row:nth-child(4)')).join(' ');
  expect(heard).toContain('A connection to region1.google-analytics.com');
  expect(heard).toMatch(/Blocked by (?:code )?default-src/);
  expect(heard).toContain('31 reports on 6 pages from');
  expect(heard).toMatch(/line below allows it/);
});

test("inline code gets the safe way first; 'unsafe-inline' only when asked, with what it costs before the line", async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  const attr = row(page, 'A style attribute');
  await open(attr);
  await expect(attr).toContainText('The safest way is to move these styles into your stylesheet, as classes');
  const fold = attr.locator('.violation-weaker:not(.violation-hash)');
  await expect(fold.locator('.code-block')).toBeHidden();
  await fold.getByText('A quicker way, less safe').click();
  await expect(fold.locator('.violation-risk')).toContainText('This lets every style attribute apply, including one an attacker slips in');
  await expect(fold.locator('figcaption > span')).toHaveText('If you accept that, add this rule to your policy');
  await expect(fold.locator('pre')).toHaveText("style-src-attr 'unsafe-inline'");
  // Heard in that order: the safe way, the fold, what it costs, then the line.
  const heard = (await readAloud(page, '.report-row:nth-child(6)')).join(' ');
  expect(heard).toMatch(/The safest way.*A quicker way, less safe.*This lets every (?:code )?style.*style-src-attr 'unsafe-inline'/);
  // The checkout's inline script, under a rule with a nonce: 'unsafe-inline' would be ignored, so it isn't offered.
  const inline = row(page, 'A script written in the page');
  await open(inline);
  await expect(inline).toContainText("Your script-src rule has a nonce or a hash, so browsers ignore 'unsafe-inline' there");
  await expect(inline.locator('.violation-weaker:not(.violation-hash)')).toHaveCount(0);
  // The hash generator, folded until asked for.
  await expect(inline.getByRole('textbox')).toBeHidden();
  await inline.getByText('Get the hash from the code').click();
  await expect(inline.getByRole('textbox')).toBeVisible();
});

test('a report-only policy says whether it can be enforced: not yet, ready since the fix, too soon over two days', async ({ page }) => {
  await openReader(page);
  // A trial policy: Hotjar blocked until the 3rd (then allowed in production, not here), an extension all along.
  const TRIAL = "default-src 'self'; script-src 'self'; report-to csp";
  const at = (day: number, blockedURL: string) =>
    JSON.stringify({ timestamp: Date.UTC(2026, 10, day, 12), type: 'csp-violation', body: { documentURL: 'https://shop.example.com/', blockedURL, effectiveDirective: 'script-src-elem', originalPolicy: TRIAL, disposition: 'report' } });
  const lines = [1, 2, 3].map((d) => at(d, 'https://static.hotjar.com/c/hotjar-1.js'));
  for (let d = 1; d <= 12; d++) lines.push(at(d, 'chrome-extension://abc/content.js'));
  await box(page).fill(lines.join('\n'));
  const verdict = page.locator('.report-enforce');
  await expect(verdict.getByRole('heading', { level: 3 })).toHaveText('Can you enforce it?');
  await expect(verdict).toContainText('Not yet. Once enforced, this report-only policy would block 1 thing your site uses: the problem below. The lines below allow all of them.');
  // Said in words, not only by the colour of its border.
  const heard = (await readAloud(page, '.report-enforce')).join(' ');
  expect(heard).toContain('Can you enforce it?');
  expect(heard).toMatch(/Not yet\./);

  await page.getByLabel('Only the reports since').fill('2026-11-05');
  await expect(verdict).toContainText("It looks ready. Over 7 days, its reports show nothing your site uses that it would block. The 8 reports left are set apart below: not your site's doing.");
  await expect(verdict.locator('li')).toHaveCount(3);
  await expect(verdict).toHaveClass(/ready/);

  await page.getByLabel('Only the reports since').fill('2026-11-10');
  await expect(verdict).toContainText("Nothing your site uses would be blocked, but it's too soon to say. These reports cover 2 days.");

  // An enforced policy has nothing to decide.
  await box(page).fill(CHROMIUM.split('\n').filter((l) => !l.includes('"disposition":"report"')).join('\n'));
  await expect(page.getByRole('heading', { name: /What the \d+ reports? says?/ })).toBeVisible();
  await expect(page.locator('.report-enforce')).toHaveCount(0);
});

test('reports are read in French on French pages', async ({ page }) => {
  await openReader(page, '/fr/reports');
  await page.getByRole('button', { name: 'Essayer un exemple' }).click();
  await expect(page.getByRole('heading', { name: 'Ce que disent les 138 rapports' })).toBeVisible();
  await expect(page.locator('.report-results > p').first()).toContainText('Venant de votre site : 2 à voir en premier, 3 à voir ensuite, 1 moins urgent et 1 autorisé depuis un changement de politique.');
  await expect(page.locator('.report-row-level').first()).toHaveText('À voir en premier');
  await expect(page.locator('.report-row-meta').first()).toHaveText('5 rapports');
  const first = row(page, 'Un script de static.hotjar.com');
  await open(first);
  await expect(first.locator('.violation-status')).toHaveText('Bloqué par script-src.');
  await expect(first.getByRole('link', { name: 'Hotjar' })).toHaveAttribute('href', '/fr/vendors/hotjar');
  await expect(first.locator('.report-stats > p')).toHaveText(/^46 rapports sur 6 pages depuis Chrome, Edge, Safari et Firefox\. Premier le 13 nov\. 2026, dernier le 19 nov\. 2026\.$/);
  // Its saved copy is in French too.
  await stubPrint(page);
  await page.getByRole('button', { name: 'Imprimer ou enregistrer en PDF' }).click();
  const doc = (await printed(page))!;
  expect(doc.title).toBe('Rapports de violation – shop.example.com');
  expect(doc.text).toContain('Venant de votre site : 2 à voir en premier');
});
