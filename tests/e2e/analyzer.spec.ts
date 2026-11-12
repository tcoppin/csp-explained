/** The analyzer (home page): reading a policy, its views, tools, reports, links and history. */
import { test, expect, watchErrors, openAnalyzer, pickTool, policyAction, POLICY, HELLO, HELLO_HASH } from './helpers';

test('explains a policy, checks a tool and writes the IT request', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);

  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await expect(page.locator('.policy .line')).toHaveCount(4);

  // Clicking a token explains it.
  await page.locator('.policy').getByRole('button', { name: "'self'" }).first().click();
  await expect(page.locator('.explanation')).toContainText('Your own site');

  // The editor folds into a summary once done.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Your policy' })).toBeVisible();
  await expect(page.locator('.summary')).toContainText('4 rules');

  // Check a tool: the tab shows how many are blocked.
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await expect(page.locator('.vendor-result')).toContainText('Blocked by this policy');
  await expect(page.getByRole('tab', { name: /Will my tools work/ })).toContainText('1 blocked');

  // The message for IT contains the missing domain and can be copied.
  await page.getByRole('button', { name: 'Write the request to IT' }).click();
  await expect(page.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
  const message = page.locator('textarea.message');
  await expect(message).toHaveValue(/connect-src rule \(copied from default-src\) with https:\/\/www\.googletagmanager\.com/);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

  // Other audiences get their own report.
  await page.getByRole('radio', { name: /Developers/ }).click();
  await expect(page.locator('pre.diff')).toContainText('+ connect-src');

  // Server snippets use the same in-box copy control as other code blocks.
  const snippetBox = page.locator('.code-block', { hasText: 'Add to your nginx server block' });
  await snippetBox.getByRole('button', { name: 'Copy this' }).click();
  await expect(snippetBox.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^add_header Content-Security-Policy ".*googletagmanager.*" always;$/);
  await page.getByRole('radio', { name: /Security/ }).click();
  await expect(page.locator('.findings').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('a tool the enforced policy allows but the report-only policy would report shows as such', async ({ page }) => {
  await openAnalyzer(page);
  await page
    .getByRole('textbox', { name: 'Paste a Content-Security-Policy' })
    .fill("Content-Security-Policy: default-src * data: 'unsafe-inline'\nContent-Security-Policy-Report-Only: default-src 'self'");
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await expect(page.locator('.vendor-result')).toContainText('Works, but would be reported');
  await expect(page.locator('.vendor-result')).toContainText('It works, but the report-only policy would still report it.');
  await expect(page.getByRole('tab', { name: /Will my tools work/ })).toContainText('1 reported');
});

test('counts usage without ever sending the policy', async ({ page, context, sent }) => {
  await openAnalyzer(page);
  await expect.poll(sent).toEqual(['n=visit&page=%2F']);

  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect.poll(sent).toContain('n=example');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await expect.poll(sent).toContain('n=analyze');

  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await expect.poll(sent).toContain('n=tool&tool=google-tag-manager');

  await page.getByRole('button', { name: 'Write the request to IT' }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(sent).toContain('n=copy-report&audience=simple&kind=message');

  // A share link opened elsewhere counts as such; moving within the site isn't a new visit.
  const other = await context.newPage();
  await openAnalyzer(other, page.url().replace(/^.*?\/\/[^/]+/, ''));
  await expect.poll(sent).toContain('n=shared');
  await policyAction(other, 'button', 'Clear');
  await other.getByRole('region', { name: 'Other ways to start' }).getByRole('link', { name: 'Find my CSP' }).click();
  await other.locator('.code-block', { has: other.locator('#snippet') }).getByRole('button', { name: 'Copy this' }).click();
  await expect.poll(sent).toContain('n=copy-snippet');

  expect(sent().filter((q) => q.startsWith('n=visit'))).toHaveLength(2);
  expect(sent().filter((q) => q === 'n=analyze')).toHaveLength(1);
  for (const q of sent()) expect(q).not.toMatch(/self|googletagmanager\.com|src/);
});

test('a pasted console error is explained, not analysed', async ({ page }) => {
  await openAnalyzer(page);
  await page
    .getByRole('textbox', { name: 'Paste a Content-Security-Policy' })
    .fill(`Refused to load the script 'https://cdn.vendor.example/tag.js' because it violates the following\nContent Security Policy directive: "script-src 'self'".`);
  await expect(page.locator('.issue')).toContainText('This is an error message, not your policy');
  await expect(page.locator('.policy')).toHaveCount(0);
});

test('restores the analysis from a share link', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Intercom Messenger');
  await page.getByRole('radio', { name: 'Developers' }).click();
  const url = page.url();
  expect(url).toContain('#p=');

  // Opens on the same tab, audience and tools, with the editor folded.
  const other = await page.context().newPage();
  await openAnalyzer(other, url);
  await expect(other.getByRole('tab', { name: /Will my tools work/ })).toHaveAttribute('aria-selected', 'true');
  await expect(other.getByRole('radio', { name: 'Developers' })).toHaveAttribute('aria-checked', 'true');
  await expect(other.locator('.vendor-result h3')).toHaveText('Intercom Messenger');
  await other.getByRole('button', { name: 'Edit' }).click();
  await expect(other.getByRole('textbox', { name: 'Paste a Content-Security-Policy' })).toHaveValue(POLICY);
});

test("a site address we can't read says so, a mistyped scheme doesn't", async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByText('Your site address (optional)').click();
  const site = page.locator('.site-field input');
  const warning = page.getByText("We can't read this address");

  await site.fill('shop example');
  await expect(warning).toBeVisible();
  await expect(site).toHaveAttribute('aria-invalid', 'true');

  for (const typed of ['http:/shop.example.com', 'https:shop.example.com', 'http://shop.example.com']) {
    await site.fill(typed);
    await expect(warning).toBeHidden();
    await expect(site).toHaveAttribute('aria-invalid', 'false');
  }
});

test("a tool shows what's missing first, and folds what already works", async ({ page }) => {
  await openAnalyzer(page);
  // Google Tag Manager's script host is listed; its inline snippet, image and data hosts are not.
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  const gtm = page.getByRole('region', { name: 'Google Tag Manager' });
  const working = gtm.locator('details.working');
  await expect(gtm.locator('.req-blocked').first()).toBeVisible();
  await expect(working.locator('summary')).toHaveText('Show the one that already works');
  await expect(working.locator('.req-allowed')).toBeHidden();
  await working.locator('summary').click();
  await expect(working.locator('.req-allowed', { hasText: 'https://www.googletagmanager.com' })).toBeVisible();

  // A policy that restricts none of it: nothing to fix, everything folded.
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("object-src 'none'");
  await expect(gtm.locator('> .requirements')).toHaveCount(0);
  await expect(gtm.locator('details.working summary')).toHaveText(/^Show the \d+ that already work$/);
});

test('tools are picked from a searchable multi-select', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();

  const combo = page.getByRole('combobox', { name: 'Add a tool' });
  const picked = page.getByRole('list', { name: 'Selected tools' });

  // Abbreviations work, Enter picks the highlighted option and the list stays open.
  await combo.fill('gtm');
  await expect(page.getByRole('option')).toHaveCount(1);
  await combo.press('Enter');
  await expect(picked.getByRole('button', { name: 'Remove Google Tag Manager' })).toBeVisible();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(combo).toHaveValue('');

  // Arrow keys move through the full list; picked options are marked selected.
  await combo.press('ArrowDown');
  await combo.press('Enter');
  await expect(page.getByRole('option', { name: 'Google Tag Manager' })).toHaveAttribute('aria-selected', 'true');
  await expect(picked.getByRole('listitem')).toHaveCount(2);

  // Backspace in the empty field removes the last tool; Escape closes the list.
  await combo.press('Backspace');
  await expect(picked.getByRole('listitem')).toHaveCount(1);
  await combo.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();

  // Chips remove their tool; unknown tools offer a suggestion link.
  await picked.getByRole('button', { name: 'Remove Google Tag Manager' }).click();
  await expect(page.locator('.vendor-result')).toHaveCount(0);
  await combo.fill('no such tool');
  await expect(page.getByText('No tool matches')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Missing a tool? Suggest it' })).toBeVisible();
});

test('views can be switched with the keyboard', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Read it/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'What it allows' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Scripts');
});

test('options are chosen with the arrow keys', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  const everyone = page.getByRole('radio', { name: 'Everyone' });
  await everyone.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Developers' })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Developers' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(everyone).toBeFocused();
  await expect(everyone).toHaveAttribute('aria-checked', 'true');
  // Only the chosen option is in the tab order.
  await expect(page.getByRole('radio', { name: 'Security' })).toHaveAttribute('tabindex', '-1');
});

test('a directive written three times is one thing to check', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'self'; script-src https://a.example; script-src 'none'; object-src 'none'");
  await expect(page.locator('.issue-list li')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /Read it/ })).toContainText('1 to check');
  // The copy the browser uses carries no warning; the ignored copies do.
  await expect(page.locator('.policy .line').nth(0).locator('.flag')).toHaveCount(0);
  await expect(page.locator('.policy .line').nth(2).locator('.flag')).toHaveCount(1);
});

test('serious weaknesses are things to check for everyone, in plain words', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'self' 'unsafe-inline'; object-src 'none'");
  await expect(page.getByRole('tab', { name: /Read it/ })).toContainText('1 to check');
  const issues = page.locator('.issues');
  await expect(issues.locator('.finding')).toHaveCount(1);
  await expect(issues).toContainText('Code written directly in the page is allowed to run');

  // Developers get the security review's words; the link opens the review without changing the reader kept for later.
  await page.getByRole('radio', { name: 'Developers' }).click();
  await expect(issues).toContainText('removes most of the protection against XSS');
  await page.getByRole('radio', { name: 'Everyone' }).click();
  await issues.getByRole('button', { name: 'The full security review' }).click();
  await expect(page.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: 'Security' })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('csp-explained:audience'))).toBe('simple');
});

test('switching policy on another view still explains the policy shown', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'self', img-src 'self'");
  await page.locator('.policy').getByRole('button', { name: "'self'" }).click();
  await expect(page.locator('.explanation')).toContainText('script-src');
  await page.getByRole('tab', { name: 'What it allows' }).click();
  await page.getByRole('radio', { name: 'Policy 2' }).click();
  await page.getByRole('tab', { name: /Read it/ }).click();
  await expect(page.locator('.explanation')).toContainText('img-src');
});

test('on phones, the views show numbers, and the explanation opens as a sheet', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  const errors = watchErrors(page);
  await openAnalyzer(page);
  await page.getByRole('button', { name: 'Try an example' }).click();

  // The row shows "1"; screen readers and the line under the row get the full badge.
  const read = page.getByRole('tab', { name: /Read it/ });
  // The example has one mistake (report-uri) and one serious weakness ('unsafe-inline' in script-src).
  await expect(read).toHaveAccessibleName(/^Read it\s*2 to check$/);
  await expect(read.locator('.count .view-short')).toHaveText('2');
  const status = page.locator('.view-status');
  await expect(status).toHaveText('2 to check');

  const sheet = page.locator('.sheet');
  await expect(sheet).toBeHidden();
  await page.locator('.tok', { hasText: "'unsafe-inline'" }).first().click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Inline code');
  await page.getByRole('button', { name: 'Close the explanation' }).click();
  await expect(sheet).toBeHidden();

  await status.getByRole('button', { name: '2 to check' }).click();
  await expect(page.getByRole('heading', { name: 'Things to check' })).toBeInViewport();
  await page.getByRole('tab', { name: 'What it allows' }).click();
  await expect(status).toBeHidden();
  expect(errors).toEqual([]);
});

test("the allow map shows the sources 'strict-dynamic' makes the browser ignore", async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'nonce-abc' 'strict-dynamic' https://cdn.vendor.test");
  await page.getByRole('tab', { name: 'What it allows' }).click();
  const scripts = page.getByRole('row', { name: /^Scripts/ });
  await expect(scripts.locator('.chip-ignored')).toContainText('https://cdn.vendor.test');
  await expect(scripts.locator('.chip-ignored')).toContainText('ignored by the browser here');
  await expect(scripts.locator('.chip-ignored')).toHaveCount(1);
});

test('the analyzer speaks French, and the IT message can be written in English', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page, '/fr');
  await page.getByRole('textbox', { name: 'Collez une Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Mes outils fonctionneront-ils/ }).click();
  await page.getByRole('combobox', { name: 'Ajouter un outil' }).fill('Hotjar');
  await page.getByRole('option', { name: 'Hotjar' }).click();
  await expect(page.getByText('Bloqué par cette politique')).toBeVisible();

  await page.getByRole('button', { name: "Rédiger la demande à l'informatique" }).click();
  const message = page.getByRole('textbox', { name: 'Votre rapport' });
  await expect(message).toHaveValue(/^Objet\u00a0: Politique de sécurité du site/);
  await expect(message).toHaveValue(/Code de suivi|Charge le script de suivi|Hotjar est bloqué/);

  await page.getByRole('radio', { name: 'English' }).click();
  await expect(message).toHaveValue(/^Subject: Website security policy: request to allow Hotjar/);
  await expect(message).toHaveValue(/https:\/\/csp-explained\.com\/(?!fr)/);
  // The page itself stays in French.
  await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('tab', { name: 'Rapport' })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the analyzer offers hashes in place of 'unsafe-inline', also from the security report", async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("default-src 'self'; script-src 'self' 'unsafe-inline'");
  await page.getByRole('radio', { name: 'Security' }).click();
  await page.getByRole('tab', { name: /Report/ }).click();
  await page.getByRole('button', { name: 'Replace it with hashes' }).first().click();

  await expect(page.locator('.hash-fix')).toHaveAttribute('open', '');
  await page.getByRole('textbox', { name: /Paste an inline script/ }).fill(HELLO);
  await page.getByRole('button', { name: 'Get the hash' }).click();
  await expect(page.locator('.code-block', { hasText: 'Your policy with the hashes' })).toContainText(
    `default-src 'self'; script-src 'self' 'unsafe-inline' ${HELLO_HASH}`,
  );
  await expect(page.locator('.hash-warning')).toContainText('Every other inline script');
  expect(errors).toEqual([]);
});

test('tools picked under a policy that enforces Trusted Types come with a note', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(`${POLICY}; require-trusted-types-for 'script'`);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await expect(page.locator('.trusted-types-note')).toHaveCount(0);
  await pickTool(page, 'Hotjar');
  await expect(page.locator('.trusted-types-note')).toContainText("don't say in their documentation");
  await expect(page.locator('.trusted-types-note').getByRole('link', { name: 'What Trusted Types change' })).toHaveAttribute('href', '/trusted-types');
});

test('recent analyses are kept only once asked for, reopen where they were left, and can be turned off', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);
  // Nothing is stored before the visitor asks for a history.
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('csp-explained:recent')))).toEqual([]);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill('');
  await page.getByRole('button', { name: 'Keep a history on this device' }).click();
  await expect(page.getByText('History on: your next analyses will be listed here')).toBeVisible();

  // Nothing listed before a first analysis, nor for the example.
  await expect(page.locator('.recent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.waitForTimeout(1300);
  await policyAction(page, 'button', 'Clear');
  await expect(page.locator('.recent')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Hotjar');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('csp-explained:recent') ?? '')).toContain('hotjar');

  // Survives a reload; reopening brings back the tools and the view.
  await openAnalyzer(page);
  const item = page.locator('.recent-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("default-src 'self'; script-src");
  await expect(item).toContainText('Tools: Hotjar');
  await item.locator('.recent-open').click();
  await expect(page.getByRole('tab', { name: /Will my tools work/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.vendor-result')).toContainText('Hotjar');

  // A second analysis comes first; deleting one leaves the other.
  await policyAction(page, 'button', 'Clear');
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("img-src 'self'");
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1300);
  await policyAction(page, 'button', 'Clear');
  await expect(item).toHaveCount(2);
  await expect(item.first()).toContainText("img-src 'self'");
  await item.first().getByRole('button', { name: /Delete the analysis from/ }).click();
  await expect(item).toHaveCount(1);

  // Turning the history off forgets it, and is remembered.
  await page.getByRole('button', { name: 'Stop keeping a history' }).click();
  await expect(page.locator('.recent')).toHaveCount(0);
  await openAnalyzer(page);
  await expect(page.getByRole('button', { name: 'Keep a history on this device' })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('csp-explained:recent')))).toEqual([]);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => localStorage.getItem('csp-explained:recent'))).toBeNull();
  expect(errors).toEqual([]);
});

test('a history kept before it became opt-in carries on, unless it was turned off', async ({ page }) => {
  await openAnalyzer(page);
  const entry = { id: 'old', policy: POLICY, site: '', vendors: {}, view: 'read', audience: 'simple', savedAt: 1 };
  await page.evaluate((e) => localStorage.setItem('csp-explained:recent', JSON.stringify([e])), entry);
  await openAnalyzer(page);
  await expect(page.locator('.recent-item')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('csp-explained:recent-on'))).toBe('1');

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('csp-explained:recent-off', '1');
  });
  await openAnalyzer(page);
  await expect(page.getByRole('button', { name: 'Keep a history on this device' })).toBeVisible();
  // The button is in the server-rendered page; the old key goes once the island's effects have run.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
