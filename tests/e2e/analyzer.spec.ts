import { expect, test, type Page } from '@playwright/test';

/** Fails the test on any console error, including CSP violations of our own policy. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Waits until the analyzer island is interactive. */
async function openAnalyzer(page: Page, path = '/') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

/** Adds a tool through the searchable multi-select. */
async function pickTool(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Add a tool' }).fill(name);
  await page.getByRole('option', { name }).click();
}

const POLICY = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; img-src 'self' data:; object-src 'none'";

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

test('no word is glued to a link or inline code on any page', async ({ page }) => {
  // Astro drops a line break between an inline element and the next word ("<a>…</a>\nlibrary" → "…library").
  await page.goto('/vendors');
  const vendorPages = await page.locator('main a[href^="/vendors/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  await page.goto('/directives');
  const directivePages = await page.locator('main a[href^="/directives/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const paths = ['/', '/find-my-csp', '/learn', '/vendors', '/directives', '/about', '/404', ...vendorPages, ...directivePages];

  const glued: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('main :is(p, li, dd, dt, td, figcaption, summary, h1, h2, h3) > :is(a, code, strong, em, kbd)')].flatMap((el) => {
        const next = el.nextSibling;
        const prev = el.previousSibling;
        const out: string[] = [];
        if (next?.nodeType === Node.TEXT_NODE && /^[\p{L}\p{N}(]/u.test(next.textContent ?? '')) out.push(`${el.textContent}|${next.textContent?.slice(0, 15)}`);
        if (prev?.nodeType === Node.TEXT_NODE && /[\p{L}\p{N},.:;)]$/u.test(prev.textContent ?? '')) out.push(`${prev.textContent?.slice(-15)}|${el.textContent}`);
        return out;
      }),
    );
    glued.push(...found.map((f) => `${path}: ${f}`));
  }
  expect(glued).toEqual([]);
});

test('the colour theme can be chosen and is remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/learn');
  const html = page.locator('html');
  await expect(page.getByRole('radio', { name: 'Match my system' })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(39, 40, 34)');

  await page.getByRole('radio', { name: 'Match my system' }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect(errors).toEqual([]);
});

test('find my CSP shows one method at a time', async ({ page }) => {
  await page.goto('/find-my-csp');
  await expect(page.locator('#console')).toBeVisible();
  await expect(page.locator('#terminal')).toBeHidden();

  // The snippet is visible and copied from inside its box.
  const snippetBox = page.locator('.code-block', { has: page.locator('#snippet') });
  await expect(snippetBox.locator('pre')).toBeVisible();
  await snippetBox.getByRole('button', { name: 'Copy this' }).click();
  await expect(snippetBox.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await snippetBox.locator('pre').textContent());

  await page.getByRole('tab', { name: /Network tab/ }).click();
  await expect(page).toHaveURL(/#devtools$/);
  await expect(page.locator('#console')).toBeHidden();
  // Chromium: the Chrome & Edge steps are selected for the reader.
  await expect(page.getByRole('tab', { name: 'Chrome & Edge' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#browser-firefox')).toBeHidden();

  // Deep links open the right method.
  await page.goto('/find-my-csp#terminal');
  await expect(page.locator('#terminal')).toBeVisible();
});

test('every page loads without errors under our own CSP', async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of ['/', '/find-my-csp', '/learn', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src', '/about']) {
    const res = await page.goto(path);
    expect(res?.ok(), path).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('text fits a 360px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Optimizely has the longest tool name, the learn page a long host in its example policy.
  for (const path of ['/', '/find-my-csp', '/learn', '/vendors', '/vendors/optimizely', '/directives', '/directives/script-src', '/about']) {
    await page.goto(path);
    // No text may run past the right edge of the screen (code boxes scroll on purpose and are skipped).
    const overflowing = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || node.parentElement?.closest('pre, .visually-hidden, [hidden]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((r) => r.right > width + 1)) found.push(node.textContent.trim());
      }
      return found;
    });
    expect(overflowing, path).toEqual([]);
  }
});

test('links to other websites open in a new tab and say so', async ({ page }) => {
  let checked = 0;
  for (const path of ['/', '/find-my-csp', '/learn', '/about', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src']) {
    await page.goto(path);
    const links = page.locator('a[href^="http"]:not([href^="http://localhost"])');
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link.locator('svg.new-tab-icon')).toBeVisible();
      await expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(5);

  // Inside the analyzer island too: the "suggest a tool" link of the tool picker.
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await page.getByRole('combobox', { name: 'Add a tool' }).fill('no such tool');
  const suggest = page.getByRole('link', { name: 'Missing a tool? Suggest it (opens in a new tab)' });
  await expect(suggest).toHaveAttribute('target', '_blank');
  await expect(suggest.locator('svg.new-tab-icon')).toBeVisible();
});

test('the find-my-csp snippet works in the DevTools console, copy() included', async ({ page }) => {
  // Serve a page with a known header and meta policy, then run the snippet shown on /find-my-csp.
  await page.route('http://fixture.test/', (route) =>
    route.fulfill({
      headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'" },
      body: `<html><head><meta http-equiv="Content-Security-Policy" content="img-src *"></head><body></body></html>`,
    }),
  );
  await page.goto('/find-my-csp');
  const snippet = await page.locator('#snippet').textContent();
  await page.goto('http://fixture.test/');

  // Evaluate it the way the DevTools console does: with the console helpers (copy, $0…) in scope.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  const copied: unknown[] = [];
  const logs: string[] = [];
  cdp.on('Runtime.inspectRequested', (e) => e.hints?.copyToClipboard && copied.push(e.object.value));
  cdp.on('Runtime.consoleAPICalled', (e) => logs.push(e.args.map((a) => a.value).join(' ')));
  const { result } = await cdp.send('Runtime.evaluate', { expression: snippet!, includeCommandLineAPI: true, replMode: true });
  // Firefox only honours copy() calls made before the pasted code ends: the snippet must not wait for anything.
  expect(result.type).toBe('string');

  // What the user sees: the policy printed, then copied to the clipboard by DevTools.
  const expected = `Content-Security-Policy: default-src 'self'\n<meta http-equiv="Content-Security-Policy" content="img-src *">`;
  await expect.poll(() => copied).toEqual([expected]);
  expect(logs).toEqual([expected, 'Copied to your clipboard.']);
});
