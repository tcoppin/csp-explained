/** The analyzer (home page): reading a policy, its views, tools, reports, links and history. */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect, watchErrors, openAnalyzer, pickTool, policyAction, readAloud, announced, paste, POLICY, HELLO, HELLO_HASH } from './helpers';

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

test('a screen reader hears what the colours and marks of the policy show', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);
  await page
    .getByRole('textbox', { name: 'Paste a Content-Security-Policy' })
    .fill("script-src 'self' 'unsafe-inline' https://a.example; script-src 'none'; img-src * data: ht!tp; foo-src x");
  const heard = await readAloud(page, '.policy');
  expect(heard).toEqual(
    expect.arrayContaining([
      'button, script-src, pressed',
      "button, 'self', not pressed",
      "button, 'unsafe-inline', risky, not pressed",
      'button, script-src, ignored: this rule is repeated, something to check, not pressed',
      'button, *, risky, not pressed',
      'button, ht!tp, not valid, not pressed',
      'button, foo-src, ignored: unknown rule, something to check, not pressed',
    ]),
  );
  // Values whose colour only tells their kind apart say nothing more.
  expect(heard).toContain('button, https://a.example, not pressed');
  expect(heard).toContain('button, data:, not pressed');
  expect(errors).toEqual([]);
});

test('a screen reader hears one line naming what is explained, not the whole explanation', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY.replace("'self' https", "'self' 'unsafe-inline' https"));
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  // On phones the explanation is a sheet that opens with the pick: the line is still heard.
  expect(await live(() => page.getByRole('button', { name: /unsafe-inline/ }).click())).toEqual(["polite: 'unsafe-inline' in script-src: Inline code"]);
  expect(await live(() => page.getByRole('button', { name: 'img-src' }).click())).toEqual(['polite: img-src: Images']);
  // The explanation itself is still there to read on.
  await expect(page.locator('.explanation h3')).toHaveText('Images');
});

test('on phones, the status under the views takes the focus to the things to check, without motion if asked', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The status under the views is shown on phones only.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'self' 'unsafe-inline'; object-src 'none'");
  await page.locator('.view-status').getByRole('button', { name: '1 to check' }).click();
  const heading = page.getByRole('heading', { name: 'Things to check' });
  await expect(heading).toBeFocused();
  // No smooth scrolling: the heading is in sight straight away.
  expect(await heading.evaluate((h) => h.getBoundingClientRect().top >= 0 && h.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
});

test('the focus follows the editor and the summary as they take each other\'s place', async ({ page }) => {
  await openAnalyzer(page);
  const box = page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' });
  const heading = page.getByRole('heading', { name: 'Your policy', level: 1 });
  await box.focus();
  // A paste folds the editor away: the focus goes to the start of the result, not back to the top of the page.
  expect(await announced(page, () => paste(page, POLICY))).toContain('heading, Your policy, level 1');
  await expect(heading).toBeFocused();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(box).toBeFocused();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(heading).toBeFocused();
  await policyAction(page, 'button', 'Clear');
  await expect(box).toBeFocused();
  // Typing never moves the focus away.
  await box.fill(POLICY);
  await expect(box).toBeFocused();
});

test('with the keyboard, the policy is one stop: arrows move, Enter explains, Tab goes to the explanation', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  const policy = page.getByRole('list', { name: /^Policy 1: arrow keys move between its parts/ });
  const parts = policy.getByRole('button');
  // Only one part takes Tab: the one picked.
  await expect(policy.locator('button[tabindex="0"]')).toHaveCount(1);
  await policy.locator('button[tabindex="0"]').focus();
  await expect(page.getByText('With the keyboard: arrow keys move between the parts')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(parts.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(policy.getByRole('button', { name: 'script-src' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(policy.getByRole('button', { name: "'none'" })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(policy.getByRole('button', { name: 'img-src' })).toBeFocused();
  expect(await announced(page, () => page.keyboard.press('Enter'))).toContain('polite: img-src: Images');
  await expect(policy.getByRole('button', { name: 'img-src' })).toHaveAttribute('aria-pressed', 'true');

  // Tab leaves the policy for the explanation, which a screen reader then reads out.
  const heard = (await announced(page, () => page.keyboard.press('Tab'))).join(' ');
  await expect(page.locator('.explanation-slot')).toBeFocused();
  expect(heard).toContain('Images Which places images can come from.');
  // And Shift+Tab goes back to the part it explains.
  await page.keyboard.press('Shift+Tab');
  await expect(policy.getByRole('button', { name: 'img-src' })).toBeFocused();
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

test('on phones, the sheet never hides the part of the policy that has the focus', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout');
  await openAnalyzer(page);
  const long = Array.from({ length: 14 }, (_, i) => `${['script-src', 'img-src', 'font-src', 'connect-src', 'media-src', 'frame-src', 'style-src'][i % 7]} https://a${i}.example https://b${i}.example`);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(long.join('; '));
  const parts = page.locator('.policy button');
  await parts.first().click();
  const sheet = page.locator('.sheet.open');
  await expect(sheet).toBeVisible();
  // Moving through the whole policy with the keyboard: each part in turn stays above the sheet.
  const count = await parts.count();
  for (let i = 1; i < count; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(parts.nth(i)).toBeFocused();
    const [part, top] = await Promise.all([parts.nth(i).boundingBox(), sheet.boundingBox()]);
    expect(part!.y + part!.height, `part ${i} above the sheet`).toBeLessThanOrEqual(top!.y);
  }
  // The footer comes above it too.
  const footer = page.locator('footer a').last();
  await footer.focus();
  const [link, top] = await Promise.all([footer.boundingBox(), sheet.boundingBox()]);
  expect(link!.y + link!.height).toBeLessThanOrEqual(top!.y);
  // Closing the sheet gives the focus back to the part it explained.
  await page.getByRole('button', { name: 'Close the explanation' }).click();
  await expect(parts.first()).toBeFocused();
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

test('the allow map says which websites can show yours in a frame', async ({ page }) => {
  await openAnalyzer(page);
  const box = page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' });
  await box.fill("default-src 'self'; frame-ancestors 'self' https://partner.example");
  await page.getByRole('tab', { name: 'What it allows' }).click();
  const embed = page.getByRole('row', { name: /^Who can embed your site/ });
  await expect(embed).toContainText("'self'");
  await expect(embed).toContainText('https://partner.example');
  await box.fill("default-src 'self'");
  await expect(embed).toContainText('any website can show yours in a frame');
  // default-src doesn't cover it, and a <meta> tag can't set it.
  await box.fill(`<meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'">`);
  await expect(embed).toContainText('any website can show yours in a frame');
  await expect(embed).toContainText('ignored in a <meta> tag');
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

/** Replaces the browser's print window: records what would be printed, then closes it unless `keepOpen`. */
async function stubPrint(page: Page, keepOpen = false) {
  await page.evaluate((keep) => {
    window.print = () => {
      const w = window as unknown as { printed: object };
      w.printed = {
        text: document.querySelector<HTMLElement>('.print-host')?.innerText ?? '',
        title: document.title,
        printing: document.documentElement.classList.contains('printing'),
      };
      if (!keep) dispatchEvent(new Event('afterprint'));
    };
  }, keepOpen);
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { printed?: { text: string; title: string; printing: boolean } }).printed);

test('a report prints alone, with what the visitor chose to include, and the page comes back after', async ({ page, sent }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByText('Your site address (optional)').click();
  await page.locator('.site-field input').fill('https://shop.example.com/cart');
  await page.getByRole('radio', { name: 'Security' }).click();
  await page.getByRole('tab', { name: /Report/ }).click();
  const title = await page.title();

  // By default: the report and the policy it is about, not the rules explained.
  const save = page.getByRole('group', { name: 'Save a copy' });
  await expect(save.getByRole('checkbox', { name: 'Include the analysed policy' })).toBeChecked();
  await expect(save.getByRole('checkbox', { name: 'Include what each rule means' })).not.toBeChecked();
  await save.getByRole('checkbox', { name: 'Include what each rule means' }).check();
  await stubPrint(page);
  await save.getByRole('button', { name: 'Print or save as PDF' }).click();

  const doc = (await printed(page))!;
  expect(doc.printing).toBe(true);
  // The suggested PDF name: the report and the site.
  expect(doc.title).toBe('Security review – shop.example.com');
  expect(doc.text).toContain('shop.example.com');
  expect(doc.text).toContain('Analysed policy');
  expect(doc.text).toContain(POLICY);
  expect(doc.text).toContain('Findings in the current policy');
  expect(doc.text).toContain('What each rule means');
  // In the reader's voice: the security one here.
  expect(doc.text).toContain('The most important directive against cross-site scripting');
  await expect.poll(sent).toContain('n=export-report&audience=security&format=pdf');

  // Once the print window closes, the page is as it was, the focus still on the button.
  await expect(page.locator('.print-host')).toHaveCount(0);
  await expect(save.getByRole('button', { name: 'Print or save as PDF' })).toBeFocused();
  expect(await page.title()).toBe(title);
  expect(await page.evaluate(() => document.documentElement.classList.contains('printing'))).toBe(false);

  // Without the policy, on another reader's report: the choices stay.
  await save.getByRole('checkbox', { name: 'Include the analysed policy' }).uncheck();
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await page.getByRole('radio', { name: 'Developers' }).click();
  await page.getByRole('button', { name: 'See the change to make' }).click();
  await expect(save.getByRole('checkbox', { name: 'Include the analysed policy' })).not.toBeChecked();
  await save.getByRole('button', { name: 'Print or save as PDF' }).click();
  const change = (await printed(page))!;
  expect(change.text).toContain('Proposed CSP change');
  expect(change.text).not.toContain('Analysed policy');
  expect(change.text).toContain('Add to your nginx server block');
  expect(errors).toEqual([]);
});

test('on paper, only the report shows, in dark ink on white even in the dark theme', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openAnalyzer(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('radio', { name: 'Security' }).click();
  await page.getByRole('tab', { name: /Report/ }).click();
  await stubPrint(page, true);
  await page.getByRole('button', { name: 'Print or save as PDF' }).click();

  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await expect(page.locator('.report-doc')).toBeVisible();
  for (const hidden of ['.site-header', 'main', '.site-footer']) await expect(page.locator(hidden).first()).toBeHidden();
  const colours = await page.locator('.report-doc').evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
  expect(colours).toEqual(['rgb(42, 29, 46)', 'rgb(255, 255, 255)']);

  // On screen, the document never shows.
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.report-doc')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a report downloads as a standalone .html file, and the IT message as text', async ({ page, sent }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await page.getByRole('button', { name: 'Write the request to IT' }).click();
  const save = page.getByRole('group', { name: 'Save a copy' });

  const [txt] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .txt' }).click()]);
  expect(txt.suggestedFilename()).toBe('csp-request-to-it.txt');
  expect(readFileSync((await txt.path())!, 'utf8')).toBe(await page.locator('textarea.message').inputValue());

  const [html] = await Promise.all([page.waitForEvent('download'), save.getByRole('button', { name: 'Download .html' }).click()]);
  expect(html.suggestedFilename()).toBe('csp-request-to-it.html');
  const file = readFileSync((await html.path())!, 'utf8');
  expect(file).toMatch(/^<!doctype html>\n<html lang="en">/);
  expect(file).toContain('<title>Request to IT</title>');
  // Its styles are inside: it opens anywhere, without the site.
  expect(file).toMatch(/<style>[^<]*\.report-doc \{/);
  expect(file).toContain('connect-src rule (copied from default-src) with https://www.googletagmanager.com');
  expect(file).toContain('Open this analysis');

  // Opened on its own, it shows the same document.
  const opened = await page.context().newPage();
  await opened.setContent(file);
  await expect(opened.getByRole('heading', { level: 1 })).toHaveText('Request to IT');
  await expect(opened.getByRole('heading', { name: 'Analysed policy' })).toBeVisible();
  expect(sent()).toEqual(expect.arrayContaining(['n=export-report&audience=simple&format=txt', 'n=export-report&audience=simple&format=html']));
});

test('the French report saves in French, the IT message in the language picked for it', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await pickTool(page, 'Google Tag Manager');
  await page.getByRole('button', { name: 'Write the request to IT' }).click();
  await openAnalyzer(page, `/fr${new URL(page.url()).hash}`);
  await page.getByRole('tab', { name: /^Rapport/ }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await stubPrint(page);
  await page.getByRole('button', { name: 'Imprimer ou enregistrer en PDF' }).click();
  const doc = (await printed(page))!;
  expect(doc.text).toContain("Demande à l'équipe informatique");
  expect(doc.text).toContain('Politique analysée');
  expect(doc.text).toContain("We'd like to use Google Tag Manager");
  await expect(page.locator('.print-host')).toHaveCount(0);
});
