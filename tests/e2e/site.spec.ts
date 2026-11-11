/** Every page: header, theme, links, metadata, our own CSP, phone widths and accessibility. */
import { test, expect, watchErrors, openAnalyzer, openComparator, inEveryLanguage, POLICY, accessibilityProblems, COMPARE_EXAMPLE } from './helpers';

test('no word is glued to a link or inline code on any page', async ({ page }) => {
  // Astro drops a line break between an inline element and the next word ("<a>…</a>\nlibrary" → "…library").
  await page.goto('/vendors');
  const vendorPages = await page.locator('main a[href^="/vendors/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  await page.goto('/directives');
  const directivePages = await page.locator('main a[href^="/directives/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  const paths = ['/404', ...inEveryLanguage(['/', '/build', '/compare', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/directives', '/about', ...vendorPages, ...directivePages])];

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

test('every page loads without errors under our own CSP', async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of inEveryLanguage(['/', '/build', '/compare', COMPARE_EXAMPLE, '/build#b=nonce&v=hotjar:tracking&step=review', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src', '/about'])) {
    const res = await page.goto(path);
    expect(res?.ok(), path).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('text fits a 360px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Optimizely has the longest tool name, the learn page a long host in its example policy.
  for (const path of inEveryLanguage(['/', '/build', '/compare', COMPARE_EXAMPLE, `${COMPARE_EXAMPLE}&t=tools`, '/build#b=allowlist&v=hotjar:tracking&step=tools', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/vendors', '/vendors/optimizely', '/directives', '/directives/script-src', '/about'])) {
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
  for (const path of inEveryLanguage(['/', '/build', '/compare', '/find-my-csp', '/reporting', '/trusted-types', '/nonces', '/learn', '/about', '/vendors', '/vendors/ab-tasty', '/directives', '/directives/script-src'])) {
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

test('pages pass the automated WCAG 2.2 AA checks, in both themes', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  const pages = inEveryLanguage(['/', '/build', '/compare', '/find-my-csp', '/learn', '/directives', '/directives/script-src', '/nonces', '/reporting', '/trusted-types', '/vendors', '/vendors/hotjar', '/about']);
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
    // Each view of the comparator, and both layouts of the two policies.
    await openComparator(page, COMPARE_EXAMPLE);
    for (const tab of ['What changes', 'Both policies', 'Security', 'Your tools']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      problems.push(...(await accessibilityProblems(page, `${theme} comparison ${tab}`)));
    }
    await page.getByRole('tab', { name: /^Both policies/ }).click();
    const columns = page.getByRole('radio', { name: 'Side by side' });
    if (await columns.isVisible()) {
      await columns.click();
      problems.push(...(await accessibilityProblems(page, `${theme} comparison in columns`)));
    }
    await page.goto('/build#b=allowlist&v=hotjar:tracking&step=review');
    await page.locator('astro-island:not([ssr])').first().waitFor({ state: 'attached' });
    problems.push(...(await accessibilityProblems(page, `${theme} builder review`)));
    await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    problems.push(...(await accessibilityProblems(page, `${theme} menu`)));
  }
  expect(problems).toEqual([]);
});
