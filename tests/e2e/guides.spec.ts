/** The guides and reference pages: Find my CSP, nonces, reporting, the catalogue, directive pages. */
import { test, expect, watchErrors, openAnalyzer, readAloud, announced } from './helpers';

test("the find-my-csp snippet's \"no policy\" answer points to the builder", async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill('No Content-Security-Policy found on https://www.example.com/');
  await expect(page.locator('.issue')).toContainText("This site doesn't send a policy yet");
  await expect(page.locator('.policy')).toHaveCount(0);
  await page.locator('.issue').getByRole('link', { name: 'Build one from a blank policy' }).click();
  await expect(page).toHaveURL(/\/build$/);
});

test('guides list their sections, jump to them, and say what to read next', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto('/nonces');
  const section = page.getByRole('heading', { name: 'Rolling it out' });

  if (isMobile) {
    // Phones and narrower screens: a bar under the header, its list opened on demand.
    await expect(page.locator('.margin-nav')).toBeHidden();
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

test('the catalogue lists its categories in the margin: each opens its tools, and the search narrows the list', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto('/vendors');
  const side = page.getByRole('complementary', { name: 'Categories' });
  if (isMobile) {
    // No room beside the column: the search and the folds are enough.
    await expect(side).toBeHidden();
    expect(errors).toEqual([]);
    return;
  }
  // The count is read as words, not a bare number.
  const heard = await readAloud(page, '.margin-nav');
  expect(heard).toContain('link, Session replay & heatmaps');
  expect(heard).toContain('4 tools');
  expect(heard.join(' ')).not.toMatch(/heatmaps, 4(?! tools)/);

  // A category opens on the way there, also when it was closed after a first visit.
  const replay = page.locator('#category-session-replay details');
  for (let i = 0; i < 2; i++) {
    await side.getByRole('link', { name: 'Session replay & heatmaps' }).click();
    await expect(replay).toHaveAttribute('open', '');
    await expect(page.getByRole('link', { name: 'Hotjar', exact: true })).toBeInViewport();
    await replay.locator('summary').click();
    await expect(replay).not.toHaveAttribute('open');
  }
  // A link from elsewhere (/vendors#category-…) opens it too.
  await page.goto('/vendors#category-payments');
  await expect(page.locator('#category-payments details')).toHaveAttribute('open', '');

  // Searching keeps only the categories that still have tools.
  await page.getByRole('searchbox', { name: 'Find a tool or an address' }).fill('hotjar');
  await expect(side.getByRole('link', { name: 'Session replay & heatmaps' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Analytics' })).toBeHidden();
  await page.getByRole('searchbox', { name: 'Find a tool or an address' }).fill('');
  await expect(side.getByRole('link', { name: 'Analytics' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Missing a tool?' })).toHaveAttribute('href', '#missing');
  expect(errors).toEqual([]);
});

test('tabs on static pages are in place from the first paint, so the panels never collapse under the reader', async ({ page, browser, baseURL }) => {
  // The page's scripts are held: the tab list and a single panel show anyway.
  await page.route('**/_astro/*.js', () => {});
  await page.goto('/find-my-csp', { waitUntil: 'commit' });
  const methods = page.getByRole('tablist', { name: 'Ways to find your policy' });
  await expect(methods).toBeVisible();
  await expect(page.locator('#console')).toBeVisible();
  await expect(page.locator('#terminal')).toBeHidden();
  // The panel the address names, when there is one.
  await page.goto('/find-my-csp#terminal', { waitUntil: 'commit' });
  await expect(page.locator('#terminal')).toBeVisible();
  await expect(page.locator('#console')).toBeHidden();
  await page.goto('/reporting', { waitUntil: 'commit' });
  await expect(page.locator('#current')).toBeVisible();
  await expect(page.locator('#legacy')).toBeHidden();

  // Without JavaScript the page reads top to bottom: every panel, no tab list.
  const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const plain = await noJs.newPage();
  await plain.goto('/find-my-csp');
  await expect(plain.locator('.methods > [role=tablist]')).toBeHidden();
  for (const id of ['console', 'devtools', 'source', 'terminal', 'errors']) await expect(plain.locator(`#${id}`)).toBeVisible();
  await noJs.close();
});

test('the catalogue search field is there from the first paint, so it never pushes the tools down', async ({ page, browser, baseURL }) => {
  // Hold the page's scripts: the field shows anyway, so nothing moves when they arrive.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_astro/*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/vendors', { waitUntil: 'commit' });
  const find = page.getByRole('searchbox', { name: 'Find a tool or an address' });
  await expect(find).toBeVisible();
  // What was typed before the script loaded is searched once it runs.
  await find.fill('goo');
  release();
  await expect(page.locator('[data-name="hotjar"]')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Google Tag Manager' })).toBeVisible();

  // Without JavaScript the field can't work: it stays hidden, and every tool shows.
  const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const plain = await noJs.newPage();
  await plain.goto('/vendors');
  await expect(plain.locator('[data-finder]')).toBeHidden();
  await expect(plain.locator('[data-name="hotjar"]')).toBeAttached();
  await noJs.close();
});

test('the catalogue finds a tool, and a tool page shows each line once with what it is for', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/vendors');
  const hotjar = page.locator('[data-name="hotjar"]');
  await expect(hotjar).toContainText('Checked Nov 23, 2026');
  await expect(hotjar.locator('.chip.unsafe')).toHaveText("'unsafe-inline'");

  await page.getByRole('searchbox', { name: 'Find a tool or an address' }).fill('goo');
  await expect(hotjar).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Session replay & heatmaps' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Google Tag Manager' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a tool or an address' }).fill('nothing like this');
  await expect(page.getByText('No tool matches.')).toBeVisible();

  await page.goto('/vendors/hotjar');
  const box = page.locator('.code-block', { hasText: 'Add to your policy' });
  await expect(box.locator('.annotated li').first()).toContainText('Loads the tracking script.');
  await box.getByRole('button', { name: 'Copy this' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^script-src https:\/\/static\.hotjar\.com https:\/\/script\.hotjar\.com 'unsafe-inline';\n/);
  await expect(page.locator('table')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the catalogue finds the tool behind an address, and the lines that cover it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/vendors');
  const find = page.getByRole('searchbox', { name: 'Find a tool or an address' });
  const contentsquare = page.locator('[data-name="contentsquare"]');

  // An address copied from a console message: only the tool and the line that cover it show.
  await find.fill("'https://cdn.us.heap-api.com/js/heap.js'.");
  await expect(page.locator('[data-name]:not([hidden])')).toHaveCount(1);
  await expect(contentsquare.locator('.uses li:not([hidden])')).toHaveText([
    'https://cdn.us.heap-api.com in script-src, for Product Analytics (Heap), US data centre.',
    'https://cdn.us.heap-api.com in script-src, for Product Analytics (Heap), EU data centre.',
  ]);
  await expect(page.locator('.near')).toBeHidden();

  // One address in several directives of one feature reads as one line.
  await find.fill('heapanalytics.com');
  await expect(contentsquare.locator('.uses li:not([hidden])')).toContainText([
    'https://heapanalytics.com in connect-src, for Heap SDK v4 (older).',
    'https://heapanalytics.com in script-src, connect-src, img-src, style-src, and font-src, for Heap Visual Labeler.',
  ]);

  // A domain no tool uses itself: the tools using addresses under it, said so.
  await find.fill('google.com');
  await expect(page.locator('.near')).toHaveText('No tool uses google.com itself. These tools use addresses under it.');
  await expect(page.locator('[data-name="google ads"] .uses li:not([hidden])').first()).toContainText('https://www.google.com in');
  await expect(contentsquare).toBeHidden();

  // An address the catalogue doesn't know.
  await find.fill('cdn.my-own-site.com');
  await expect(page.locator('[data-name]:not([hidden])')).toHaveCount(0);
  await expect(page.getByText("No tool in the catalogue uses cdn.my-own-site.com. It may belong to your own site")).toBeVisible();

  // Back to a name: no address lines.
  await find.fill('content');
  await expect(contentsquare).toBeVisible();
  await expect(contentsquare.locator('.uses')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the address search speaks French on French pages', async ({ page }) => {
  await page.goto('/fr/vendors');
  await page.getByRole('searchbox', { name: 'Trouver un outil ou une adresse' }).fill('csxd.contentsquare.net');
  // Its own frame line, and the wildcard lines that cover it too.
  await expect(page.locator('[data-name="contentsquare"] .uses li:not([hidden])')).toContainText([
    '*.contentsquare.net dans script-src et connect-src, pour Experience Analytics.',
    'csxd.contentsquare.net dans frame-src, pour Suivi entre domaines (cadre hébergé par Contentsquare).',
  ]);
});

test('a screen reader hears which tools use an address, once typing pauses, and the line that covers it', async ({ page }) => {
  await page.goto('/vendors');
  const find = page.getByRole('searchbox', { name: 'Find a tool or an address' });
  const live = async (action: () => Promise<void>) => (await announced(page, action)).filter((p) => /^(polite|assertive):/.test(p));
  expect(await live(async () => {
    await find.fill('t.contentsquare.net');
    await page.waitForTimeout(600);
  })).toEqual(['polite: t.contentsquare.net is used by Contentsquare.']);
  expect(await live(async () => {
    await find.fill('google.com');
    await page.waitForTimeout(600);
  })).toEqual(['polite: No tool uses google.com itself. Addresses under it are used by Google Tag Manager, Google Analytics 4, Google Ads, Adyen Web (Drop-in and Components), Google reCAPTCHA, and Google Maps JavaScript API.']);
  expect(await live(async () => {
    await find.fill('goo');
    await page.waitForTimeout(600);
  })).toEqual(['polite: Found: Google Tag Manager, Google Analytics 4, Google Ads, Google reCAPTCHA, Google Fonts, Google Hosted Libraries, and Google Maps JavaScript API.']);
  await expect(find).toBeFocused();

  await find.fill('csxd.contentsquare.net');
  // The virtual reader marks where code starts and ends; the words come in the order of the sentence.
  const heard = (await readAloud(page, '[data-name="contentsquare"]')).join(' ').replace(/\s*(?:code|end of code)\s*/g, ' ').replace(/ ,/g, ',');
  expect(heard).toContain('csxd.contentsquare.net in frame-src, for Cross-domain tracking (frame hosted by Contentsquare).');
});

test('the catalogue folds each category, naming its tools, and a search opens those with a match', async ({ page }) => {
  await page.goto('/vendors');
  const fold = (name: string) => page.locator('section[data-group]').filter({ has: page.getByRole('heading', { name, exact: true }) }).locator('details');
  const analytics = fold('Analytics');
  const libraries = fold('Libraries & frameworks');

  // Folded: the category stays a heading, said with its count and the names of its tools.
  const heard = await readAloud(page, 'section[data-group]:nth-of-type(2) summary');
  expect(heard).toEqual(expect.arrayContaining(['heading, Analytics, level 2', '8 tools', 'Amplitude, Google Analytics 4, HubSpot, Matomo (on your own server), Piano Analytics, Piwik PRO, PostHog, and Segment (Analytics.js)']));
  await expect(page.getByRole('link', { name: 'Amplitude' })).toBeHidden();

  // Opened from the keyboard.
  await analytics.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(analytics).toHaveAttribute('open');
  await expect(page.getByRole('link', { name: 'Amplitude' })).toBeVisible();

  // A search opens the categories with a match, and only those show.
  const find = page.getByRole('searchbox', { name: 'Find a tool or an address' });
  await find.fill('jquery');
  await expect(libraries).toHaveAttribute('open');
  await expect(page.getByRole('link', { name: 'jQuery' })).toBeVisible();
  await expect(analytics.locator('xpath=..')).toBeHidden();

  // Cleared: what the visitor opened stays open, what the search opened folds back.
  await find.fill('');
  await expect(analytics).toHaveAttribute('open');
  await expect(libraries).not.toHaveAttribute('open');
});

test("a tool page shows an account address as its example, and says to replace it", async ({ page }) => {
  await page.goto('/vendors/matomo');
  await expect(page.locator('.field-note')).toContainText('Your Matomo address: in the lines below, matomo.example.com stands for it.');
  await expect(page.locator('.code-block').first()).toContainText('script-src https://matomo.example.com');
  // The Tools page names what it needs, though the lines wait on the address.
  await page.goto('/vendors');
  await expect(page.locator('[data-name="matomo (on your own server)"] .needs')).toContainText('script-src');
});

test('the address search knows every intake address a tool lists to pick from', async ({ page }) => {
  await page.goto('/vendors');
  await page.getByRole('searchbox', { name: 'Find a tool or an address' }).fill('browser-intake-datadoghq.eu');
  await expect(page.locator('[data-name="datadog rum"]')).toBeVisible();
  await expect(page.locator('[data-name="datadog rum"] [data-uses]')).toContainText('https://browser-intake-datadoghq.eu in connect-src');
  await page.goto('/vendors/datadog-rum');
  await expect(page.locator('.field-options')).toContainText('EU1 (datadoghq.eu): browser-intake-datadoghq.eu');
});

test('a tool that puts the site at risk says so in words, in the catalogue and on its page', async ({ page }) => {
  await page.goto('/vendors');
  // The highlight repeats what the words say.
  expect((await readAloud(page, '[data-name="jsdelivr"]')).join(' ')).toContain('Risky for your site');
  expect((await readAloud(page, '[data-name="hotjar"]')).join(' ')).not.toContain('Risky');

  await page.goto('/vendors/jsdelivr');
  const heard = (await readAloud(page, 'main')).join(' ').replace(/\s*(?:strong|end of strong)\s*/g, ' ').replace(/ :/g, ':');
  expect(heard).toContain('Risk: Allowing all of jsDelivr lets code from anyone run on your site.');
  // Heard before the button to check a policy against the tool.
  expect(heard.indexOf('Risk:')).toBeLessThan(heard.indexOf('Check jsDelivr against my policy'));
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
