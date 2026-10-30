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

/** Usage events sent to `/e` during the test, as query strings. There is no `/e` in `astro preview`. */
let usage: URLSearchParams[] = [];
test.beforeEach(async ({ context }) => {
  usage = [];
  await context.route('**/e?*', (route) => {
    usage.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ status: 204 });
  });
});
const sent = () => usage.map((q) => q.toString());

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

/** Each path in English and in French (`/learn` → `/learn`, `/fr/learn`). */
const inEveryLanguage = (paths: string[]) => paths.flatMap((p) => [p, p === '/' ? '/fr' : `/fr${p}`]);

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

test('counts usage without ever sending the policy', async ({ page, context }) => {
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
  await other.getByRole('button', { name: 'Edit' }).click();
  await other.getByRole('link', { name: "Here's how to find it" }).click();
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

test("the allow map shows the sources 'strict-dynamic' makes the browser ignore", async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'nonce-abc' 'strict-dynamic' https://cdn.vendor.test");
  await page.getByRole('tab', { name: 'What it allows' }).click();
  const scripts = page.getByRole('row', { name: /^Scripts/ });
  await expect(scripts.locator('.chip-ignored')).toContainText('https://cdn.vendor.test');
  await expect(scripts.locator('.chip-ignored')).toContainText('ignored by the browser here');
  await expect(scripts.locator('.chip-ignored')).toHaveCount(1);
});

test('no word is glued to a link or inline code on any page', async ({ page }) => {
  // Astro drops a line break between an inline element and the next word ("<a>…</a>\nlibrary" → "…library").
  await page.goto('/vendors');
  const vendorPages = await page.locator('main a[href^="/vendors/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  await page.goto('/directives');
  const directivePages = await page.locator('main a[href^="/directives/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const paths = ['/404', ...inEveryLanguage(['/', '/find-my-csp', '/learn', '/vendors', '/directives', '/about', ...vendorPages, ...directivePages])];

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

test('pages describe themselves for link previews', async ({ page, request }) => {
  await page.goto('/find-my-csp');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://csp-explained.com/find-my-csp');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /^Find your website's CSP/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://csp-explained.com/og-image.png');
  const image = await request.get('/og-image.png');
  expect(image.headers()['content-type']).toBe('image/png');
});

test('search engines get a sitemap of the pages, and robots.txt points to it', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Sitemap: https://csp-explained.com/sitemap-index.xml');
  const sitemap = await (await request.get('/sitemap-0.xml')).text();
  expect(sitemap).toContain('<loc>https://csp-explained.com/find-my-csp</loc>');
  expect(sitemap).toContain('<loc>https://csp-explained.com/directives/script-src</loc>');
  expect(sitemap).not.toContain('404');
  // Each page lists its other language.
  expect(sitemap).toContain('<xhtml:link rel="alternate" hreflang="fr" href="https://csp-explained.com/fr/find-my-csp"/>');
});

test('the French site stays in French and links to the same page in English', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/fr/learn');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('h1')).toHaveText("Qu'est-ce qu'une Content-Security-Policy\u202f?");
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'https://csp-explained.com/learn');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://csp-explained.com/og-image-fr.png');
  expect((await request.get('/og-image-fr.png')).headers()['content-type']).toBe('image/png');

  // Every link within the site, in the header, the page and the footer, stays on French pages.
  for (const path of ['/fr', '/fr/learn', '/fr/find-my-csp', '/fr/vendors', '/fr/vendors/hotjar', '/fr/directives', '/fr/directives/script-src', '/fr/about']) {
    await page.goto(path);
    const english = await page
      .locator('a[href^="/"]:not([data-lang-switch])')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')!).filter((h) => h !== '/fr' && !h.startsWith('/fr/') && !h.startsWith('/fr#')));
    expect(english, path).toEqual([]);
  }

  // The language switch, in the footer, opens the same page, keeping what follows the #.
  await page.goto('/fr/find-my-csp#terminal');
  await expect(page.getByRole('banner').getByRole('link', { name: 'English' })).toHaveCount(0);
  await page.getByRole('contentinfo').getByRole('navigation', { name: 'Langue' }).getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/find-my-csp#terminal$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Français' }).click();
  await expect(page).toHaveURL(/\/fr\/find-my-csp#terminal$/);
  expect(errors).toEqual([]);
});

test.describe('a visitor whose browser prefers French', () => {
  test.use({ locale: 'fr-FR' });

  test('is told, in French, that the page exists in French, and can dismiss it', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/find-my-csp#terminal');
    const note = page.locator('[data-language-note="fr"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('lang', 'fr');
    await expect(note).toContainText('Cette page existe aussi en français.');

    // Dismissed once, gone on the next pages too.
    await note.getByRole('button', { name: 'Fermer' }).click();
    await expect(note).toBeHidden();
    await page.goto('/learn');
    await expect(page.locator('[data-language-note]')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('follows the note to the same page in French, keeping the # part, and sees no note there', async ({ page }) => {
    await page.goto('/find-my-csp#terminal');
    await page.getByRole('link', { name: 'La lire en français' }).click();
    await expect(page).toHaveURL(/\/fr\/find-my-csp#terminal$/);
    await expect(page.locator('[data-language-note]')).toBeHidden();
  });
});

test('a browser that prefers English sees no note on English pages', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.locator('[data-language-note]')).toBeHidden();
});

test('the 404 page speaks both languages', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page isn't on the list");
  const french = page.locator('section[lang="fr"]');
  await expect(french.getByRole('heading')).toHaveText("Cette page n'est pas sur la liste");
  await expect(french.getByRole('link', { name: "Aller à l'analyseur" })).toHaveAttribute('href', '/fr');
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

test('every page loads without errors under our own CSP', async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of inEveryLanguage(['/', '/find-my-csp', '/learn', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src', '/about'])) {
    const res = await page.goto(path);
    expect(res?.ok(), path).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('text fits a 360px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Optimizely has the longest tool name, the learn page a long host in its example policy.
  for (const path of inEveryLanguage(['/', '/find-my-csp', '/learn', '/vendors', '/vendors/optimizely', '/directives', '/directives/script-src', '/about'])) {
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
  for (const path of inEveryLanguage(['/', '/find-my-csp', '/learn', '/about', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src'])) {
    await page.goto(path);
    const links = page.locator('a[href^="http"]:not([href^="http://localhost"])');
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link.locator('svg.new-tab-icon')).toBeVisible();
      await expect(link).toHaveAccessibleName(/\((opens in a new tab|s'ouvre dans un nouvel onglet)\)$/);
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
