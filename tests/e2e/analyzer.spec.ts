import AxeBuilder from '@axe-core/playwright';
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

/** An action on the analysed policy: on phones, Open in the builder and Clear are under More. */
async function policyAction(page: Page, role: 'button' | 'link', name: string) {
  const more = page.locator('.summary-actions .more summary');
  if (await more.isVisible()) await more.click();
  await page.locator('.summary-actions').getByRole(role, { name }).click();
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

test("the find-my-csp snippet's \"no policy\" answer points to the builder", async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill('No Content-Security-Policy found on https://www.example.com/');
  await expect(page.locator('.issue')).toContainText("This site doesn't send a policy yet");
  await expect(page.locator('.policy')).toHaveCount(0);
  await page.locator('.issue').getByRole('link', { name: 'Build one from a blank policy' }).click();
  await expect(page).toHaveURL(/\/build$/);
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
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("script-src 'self'; script-src https://a.example; script-src 'none'");
  await expect(page.locator('.issue-list li')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /Read it/ })).toContainText('1 to check');
  // The copy the browser uses carries no warning; the ignored copies do.
  await expect(page.locator('.policy .line').nth(0).locator('.flag')).toHaveCount(0);
  await expect(page.locator('.policy .line').nth(2).locator('.flag')).toHaveCount(1);
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
  await expect(read).toHaveAccessibleName(/^Read it\s*1 to check$/);
  await expect(read.locator('.count .view-short')).toHaveText('1');
  const status = page.locator('.view-status');
  await expect(status).toHaveText('1 to check');

  const sheet = page.locator('.sheet');
  await expect(sheet).toBeHidden();
  await page.locator('.tok', { hasText: "'unsafe-inline'" }).first().click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Inline code');
  await page.getByRole('button', { name: 'Close the explanation' }).click();
  await expect(sheet).toBeHidden();

  await status.getByRole('button', { name: '1 to check' }).click();
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

test('no word is glued to a link or inline code on any page', async ({ page }) => {
  // Astro drops a line break between an inline element and the next word ("<a>…</a>\nlibrary" → "…library").
  await page.goto('/vendors');
  const vendorPages = await page.locator('main a[href^="/vendors/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  await page.goto('/directives');
  const directivePages = await page.locator('main a[href^="/directives/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const paths = ['/404', ...inEveryLanguage(['/', '/build', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/directives', '/about', ...vendorPages, ...directivePages])];

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

test('the header leads to every page, Learn and Menu opening one at a time', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.goto('/nonces');
  const banner = page.getByRole('banner');
  const learn = banner.getByRole('button', { name: 'Learn' });
  const menu = banner.getByRole('button', { name: 'Menu' });
  const panel = page.getByRole('navigation', { name: 'Menu' });

  if (isMobile) {
    // Phones get the brand and Menu only.
    await expect(learn).toBeHidden();
  } else {
    await learn.click();
    await expect(learn).toHaveAttribute('aria-expanded', 'true');
    await expect(banner.locator('#nav-learn').getByRole('link', { name: /^Moving to nonces/ })).toHaveAttribute('aria-current', 'page');
    await menu.click();
    await expect(learn).toHaveAttribute('aria-expanded', 'false');
    await expect(banner.locator('#nav-learn')).toBeHidden();
  }
  if (isMobile) await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const pages = ['Analyzer', 'Build a policy', 'Find my CSP', 'What is a CSP?', 'Every directive', 'Moving to nonces', 'Violation reports', 'Trusted Types', 'Tool catalogue', 'About'];
  for (const name of pages) await expect(panel.getByRole('link', { name: new RegExp(`^${name.replace('?', '\\?')} `) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toBeFocused();

  // In French, the page under a guide marks it current, and links stay in French.
  await page.goto('/fr/directives/script-src');
  await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
  await expect(panel.getByRole('link', { name: /^Toutes les directives / })).toHaveAttribute('aria-current', 'page');
  await expect(panel.getByRole('link', { name: /^Catalogue des outils / })).toHaveAttribute('href', '/fr/vendors');
  await panel.getByRole('link', { name: /^Passer aux nonces / }).click();
  await expect(page).toHaveURL(/\/fr\/nonces$/);
  expect(errors).toEqual([]);
});

test('guides list their sections, jump to them, and say what to read next', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto('/nonces');
  const section = page.getByRole('heading', { name: 'Rolling it out' });

  if (isMobile) {
    // Phones and narrower screens: a bar under the header, its list opened on demand.
    await expect(page.locator('.toc-side')).toBeHidden();
    const bar = page.locator('.toc-bar');
    await bar.locator('summary').click();
    await bar.getByRole('link', { name: 'Rolling it out' }).click();
    await expect(bar).not.toHaveAttribute('open');
    await expect(section).toBeInViewport();
    await expect(bar.locator('[data-toc-current]')).toHaveText('Rolling it out');
  } else {
    // Wide screens: the contents stay in the margin and mark the section being read.
    await expect(page.locator('.toc-bar')).toBeHidden();
    const side = page.getByRole('complementary', { name: 'On this page' });
    await side.getByRole('link', { name: 'Rolling it out' }).click();
    await expect(section).toBeInViewport();
    await expect(side.getByRole('link', { name: 'Rolling it out' })).toHaveAttribute('aria-current', 'location');
  }

  const next = page.getByRole('complementary', { name: 'Read next' });
  await expect(next.getByRole('link', { name: /^Violation reports/ })).toHaveAttribute('href', '/reporting');
  await page.goto('/fr/nonces');
  await expect(page.getByRole('complementary', { name: 'À lire ensuite' }).getByRole('link', { name: /^Rapports de violation/ })).toHaveAttribute(
    'href',
    '/fr/reporting',
  );
  expect(errors).toEqual([]);
});

test('the catalogue finds a tool, and a tool page shows each line once with what it is for', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/vendors');
  const hotjar = page.locator('[data-name="hotjar"]');
  await expect(hotjar).toContainText('Checked Oct 29, 2026');
  await expect(hotjar.locator('.chip.unsafe')).toHaveText("'unsafe-inline'");

  await page.getByRole('searchbox', { name: 'Find a tool' }).fill('goo');
  await expect(hotjar).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Session replay & heatmaps' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Google Tag Manager' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a tool' }).fill('nothing like this');
  await expect(page.getByText('No tool matches.')).toBeVisible();

  await page.goto('/vendors/hotjar');
  const box = page.locator('.code-block', { hasText: 'Add to your policy' });
  await expect(box.locator('.annotated li').first()).toContainText('Loads the tracking script.');
  await box.getByRole('button', { name: 'Copy this' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^script-src https:\/\/static\.hotjar\.com https:\/\/script\.hotjar\.com 'unsafe-inline';\n/);
  await expect(page.locator('table')).toHaveCount(0);
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
  for (const path of ['/fr', '/fr/build', '/fr/build#b=allowlist&step=review', '/fr/learn', '/fr/find-my-csp', '/fr/vendors', '/fr/vendors/hotjar', '/fr/directives', '/fr/directives/script-src', '/fr/about']) {
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
  for (const path of inEveryLanguage(['/', '/build', '/build#b=nonce&v=hotjar:tracking&step=review', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src', '/about'])) {
    const res = await page.goto(path);
    expect(res?.ok(), path).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('text fits a 360px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Optimizely has the longest tool name, the learn page a long host in its example policy.
  for (const path of inEveryLanguage(['/', '/build', '/build#b=allowlist&v=hotjar:tracking&step=tools', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/vendors/optimizely', '/directives', '/directives/script-src', '/about'])) {
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
  for (const path of inEveryLanguage(['/', '/build', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/about', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src'])) {
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

test('the footer reports an issue about the page, never about a shared policy', async ({ page }) => {
  await page.goto('/fr/learn#p=secret-policy');
  const link = page.getByRole('link', { name: "Signaler un problème (s'ouvre dans un nouvel onglet)" });
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin + url.pathname).toBe('https://github.com/tcoppin/csp-explained/issues/new');
  expect(url.searchParams.get('body')).toContain('Page : https://csp-explained.com/fr/learn\n');
  expect(url.href).not.toContain('secret-policy');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: "Code source (s'ouvre dans un nouvel onglet)" })).toHaveAttribute(
    'href',
    'https://github.com/tcoppin/csp-explained',
  );
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

/** Waits until the builder island is interactive. */
async function openBuilder(page: Page, path = '/build') {
  await page.goto(path);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
}

test('builds a policy from nothing, with a catalogue tool and one of our own', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openBuilder(page);
  await page.getByRole('radio', { name: /^A blank policy/ }).check();
  await page.getByRole('radio', { name: /^No, or not sure/ }).check();
  await page.getByRole('button', { name: 'Next: your site' }).click();

  await page.getByRole('checkbox', { name: /Have styles written directly in the page/ }).check();
  const preview = page.getByRole('complementary', { name: 'Your policy so far' });
  await expect(preview).toContainText("style-src 'self' 'unsafe-inline'");
  await page.getByRole('button', { name: 'Next: your tools' }).click();

  await pickTool(page, 'Hotjar');
  await expect(page.locator('details.tool[open] summary')).toContainText('Hotjar');
  await expect(preview).toContainText('wss://*.hotjar.com');

  // A tool the catalogue doesn't know, described from what was typed in the picker.
  await page.getByRole('combobox', { name: 'Add a tool' }).fill('Our CDN');
  await page.getByRole('button', { name: 'Describe “Our CDN” yourself' }).click();
  await page.getByRole('combobox', { name: 'Kind of resource' }).selectOption('img');
  await page.getByRole('textbox', { name: 'Addresses, separated by spaces' }).fill('cdn.example.org self');
  await expect(page.getByText('Not understood by browsers: self.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Addresses, separated by spaces' }).fill('https://cdn.example.org');
  await page.getByRole('button', { name: 'Add this tool' }).click();
  await expect(page.getByRole('list', { name: 'Selected tools' })).toContainText('Our CDN');
  await expect(preview).toContainText('https://cdn.example.org');

  await page.getByRole('button', { name: 'See your policy' }).click();
  await page.locator('.policy').getByRole('button', { name: 'https://cdn.example.org' }).click();
  await expect(page.locator('.who-asked')).toContainText('Our CDN: You added it for Our CDN.');
  await page.getByRole('tab', { name: /Put it live/ }).click();
  await page.locator('.code-block', { hasText: 'The policy on its own' }).getByRole('button', { name: 'Copy this' }).click();
  await expect.poll(sent).toContain('n=copy-build&kind=policy');
  expect(sent()).toContain('n=build&start=allowlist');
  expect(sent()).toContain('n=tool&tool=hotjar');
  for (const q of sent()) expect(q).not.toMatch(/cdn|example|Our/i);

  // The link keeps everything, and the tool we described is remembered in this browser.
  const again = await context.newPage();
  await openBuilder(again, page.url().replace(/^.*?\/\/[^/]+/, ''));
  await expect(again.locator('.policy')).toContainText('https://cdn.example.org');
  const fresh = await context.newPage();
  await openBuilder(fresh, '/build#b=allowlist&step=tools');
  await fresh.getByRole('combobox', { name: 'Add a tool' }).click();
  await expect(fresh.getByRole('group', { name: 'Your own tools' }).getByRole('option', { name: 'Our CDN' })).toBeVisible();
  await fresh.getByRole('combobox', { name: 'Add a tool' }).press('Escape');
  await fresh.getByRole('button', { name: 'Forget the tools saved in this browser' }).click();
  await fresh.getByRole('combobox', { name: 'Add a tool' }).click();
  await expect(fresh.getByRole('group', { name: 'Your own tools' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with a nonce, the builder explains the placeholder and what waits on it', async ({ page }) => {
  await openBuilder(page, '/build#b=nonce&n=inline-scripts&step=review');
  await expect(page.locator('.policy')).toContainText("'nonce-REPLACE_PER_PAGE' 'strict-dynamic'");
  await expect(page.locator('.policy')).not.toContainText("'unsafe-inline'");
  await page.getByRole('tab', { name: /Things to know/ }).click();
  await expect(page.getByRole('heading', { name: 'Replace the nonce placeholder' })).toBeVisible();
  await expect(page.locator('.companion-note', { hasText: 'Waiting on the nonce' })).toContainText('Have code written directly in the page');
});

test('the analyzer opens its policy in the builder, and the builder sends it back', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await policyAction(page, 'link', 'Open in the builder');
  await expect(page).toHaveURL(/\/build#/);
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page.getByRole('radio', { name: /^Your current policy/ })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Paste your policy' })).toHaveValue(/default-src/);

  await page.getByRole('button', { name: /Your policy$/ }).click();
  await page.getByRole('link', { name: 'Analyze this policy' }).click();
  await page.locator('astro-island:not([ssr])').waitFor({ state: 'attached' });
  await expect(page.getByRole('heading', { name: 'Your policy' })).toBeVisible();
});

// The example from the CSP specification, and its hash.
const HELLO = "alert('Hello, world.');";
const HELLO_HASH = "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='";

test('the builder lists inline scripts by hash, and keeps them in the link', async ({ page, context }) => {
  const errors = watchErrors(page);
  await openBuilder(page, '/build#b=allowlist&step=site');
  await page.getByRole('checkbox', { name: /Have code written directly in the page/ }).check();
  await page.getByRole('radio', { name: 'Only the ones I list' }).click();
  await page.getByRole('textbox', { name: /Paste an inline script/ }).fill(`<script>${HELLO}</script>\n<style>p {}</style>`);
  await page.getByRole('button', { name: 'Get the hash' }).click();
  await expect(page.getByRole('list', { name: 'Hashes' })).toContainText(HELLO_HASH);
  await expect(page.getByText('A <style> block was left out: this list is for scripts.')).toBeVisible();
  const preview = page.getByRole('complementary', { name: 'Your policy so far' });
  await expect(preview).toContainText(`script-src 'self' ${HELLO_HASH}`);
  await expect(preview).not.toContainText("'unsafe-inline'");

  const again = await context.newPage();
  await openBuilder(again, page.url().replace(/^.*?\/\/[^/]+/, ''));
  await expect(again.getByRole('list', { name: 'Hashes' })).toContainText(HELLO_HASH);
  expect(errors).toEqual([]);
});

test('the builder says when hashes change nothing because no directive restricts scripts', async ({ page }) => {
  const policy = Buffer.from("object-src 'none'; base-uri 'none'").toString('base64url');
  await openBuilder(page, `/build#b=policy&p=${policy}&n=inline-scripts&hi=&step=site`);
  await page.getByRole('textbox', { name: /Paste an inline script/ }).fill(HELLO);
  await page.getByRole('button', { name: 'Get the hash' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'nothing restricts scripts' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Your policy so far' })).not.toContainText(HELLO_HASH);
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

test('the reporting guide shows one report format at a time', async ({ page }) => {
  await page.goto('/reporting');
  await expect(page.locator('.code-block')).toContainText('Reporting-Endpoints: csp="https://reports.example.com/csp"');
  await expect(page.locator('#current')).toContainText('"type": "csp-violation"');
  await expect(page.locator('#legacy')).toBeHidden();
  await page.getByRole('tab', { name: 'report-uri (older)' }).click();
  await expect(page.locator('#legacy')).toContainText('"csp-report"');
  await expect(page.locator('#current')).toBeHidden();
});

test('the reporting directives point to the reporting guide', async ({ page }) => {
  for (const name of ['report-to', 'report-uri']) {
    await page.goto(`/fr/directives/${name}`);
    await expect(page.getByRole('link', { name: 'voir ce que bloque votre politique' })).toHaveAttribute('href', '/fr/reporting');
  }
});

test('tools picked under a policy that enforces Trusted Types come with a note', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(`${POLICY}; require-trusted-types-for 'script'`);
  await page.getByRole('tab', { name: /Will my tools work/ }).click();
  await expect(page.locator('.trusted-types-note')).toHaveCount(0);
  await pickTool(page, 'Hotjar');
  await expect(page.locator('.trusted-types-note')).toContainText("don't say in their documentation");
  await expect(page.locator('.trusted-types-note').getByRole('link', { name: 'What Trusted Types change' })).toHaveAttribute('href', '/trusted-types');

  await openBuilder(page, `/build#b=policy&p=${Buffer.from("default-src 'self'; require-trusted-types-for 'script'").toString('base64url')}&v=hotjar:tracking&step=tools`);
  await expect(page.locator('.trusted-types-note')).toBeVisible();
});

test('recent analyses stay in this browser, reopen where they were left, and can be turned off', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);
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
  await expect(page.getByText("Analyses aren't kept in this browser.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('csp-explained:recent'))).toBeNull();
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => localStorage.getItem('csp-explained:recent'))).toBeNull();
  expect(errors).toEqual([]);
});

test('the nonce guide shows one stack at a time, and the analyzer points to it', async ({ page }) => {
  await page.goto('/nonces');
  await expect(page.locator('#node')).toContainText("crypto.randomBytes(16).toString('base64')");
  await expect(page.locator('#django')).toBeHidden();
  await page.getByRole('tab', { name: 'Django' }).click();
  await expect(page.locator('#django')).toContainText('CSP.STRICT_DYNAMIC');
  await expect(page.locator('#node')).toBeHidden();
  await expect(page).toHaveURL(/#django$/);

  await page.goto('/fr/directives/script-src');
  await expect(page.getByRole('link', { name: 'passer aux nonces' })).toHaveAttribute('href', '/fr/nonces');

  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill("default-src 'self'; script-src 'self' 'unsafe-inline'");
  await page.getByRole('tab', { name: /Report/ }).click();
  await page.getByRole('radio', { name: 'Security' }).click();
  await expect(page.getByRole('link', { name: 'move to nonces' }).first()).toHaveAttribute('href', '/nonces');
});

/** WCAG 2.2 A and AA problems axe finds on the page as it is now, one line each. */
async function accessibilityProblems(page: Page, where: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${where}: ${v.id} (${v.impact}) ${n.target.join(' ')}`));
}

test('pages pass the automated WCAG 2.2 AA checks, in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  const pages = inEveryLanguage(['/', '/build', '/find-my-csp', '/learn', '/directives', '/directives/script-src', '/nonces', '/reporting', '/trusted-types', '/vendors', '/vendors/hotjar', '/about']);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const path of pages) {
      await page.goto(path);
      problems.push(...(await accessibilityProblems(page, `${theme} ${path}`)));
    }

    // The analysis, each view, the builder's last step and the open menu.
    await openAnalyzer(page);
    await page.getByRole('button', { name: 'Try an example' }).click();
    for (const tab of ['Read it', 'What it allows', 'Will my tools work?', 'Report']) {
      await page.getByRole('tab', { name: new RegExp(tab.replace('?', '\\?')) }).click();
      problems.push(...(await accessibilityProblems(page, `${theme} analysis ${tab}`)));
    }
    await page.goto('/build#b=allowlist&v=hotjar:tracking&step=review');
    await page.locator('astro-island:not([ssr])').first().waitFor({ state: 'attached' });
    problems.push(...(await accessibilityProblems(page, `${theme} builder review`)));
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    problems.push(...(await accessibilityProblems(page, `${theme} menu`)));
  }
  expect(problems).toEqual([]);
});
