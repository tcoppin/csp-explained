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
  })).toEqual(['polite: No tool uses google.com itself. Addresses under it are used by Google Tag Manager, Google Analytics 4, Google Ads, Google reCAPTCHA, and Google Maps JavaScript API.']);
  expect(await live(async () => {
    await find.fill('goo');
    await page.waitForTimeout(600);
  })).toEqual(['polite: Found: Google Tag Manager, Google Analytics 4, Google Ads, Google reCAPTCHA, Google Fonts, and Google Maps JavaScript API.']);
  await expect(find).toBeFocused();

  await find.fill('csxd.contentsquare.net');
  // The virtual reader marks where code starts and ends; the words come in the order of the sentence.
  const heard = (await readAloud(page, '[data-name="contentsquare"]')).join(' ').replace(/\s*(?:code|end of code)\s*/g, ' ').replace(/ ,/g, ',');
  expect(heard).toContain('csxd.contentsquare.net in frame-src, for Cross-domain tracking (frame hosted by Contentsquare).');
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
