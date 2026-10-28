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

const POLICY = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; img-src 'self' data:; object-src 'none'";

test('explains a policy, checks a tool and writes the IT request', async ({ page }) => {
  const errors = watchErrors(page);
  await openAnalyzer(page);

  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await expect(page.locator('.policy .line')).toHaveCount(4);

  // Clicking a token explains it.
  await page.locator('.policy').getByRole('button', { name: "'self'" }).first().click();
  await expect(page.locator('.explanation')).toContainText('Your own site');

  // Check a tool.
  await page.getByRole('button', { name: 'Google Tag Manager', exact: true }).click();
  await expect(page.locator('.vendor-result')).toContainText('Blocked by this policy');

  // The message for IT contains the missing domain and can be copied.
  const message = page.locator('textarea.message');
  await expect(message).toHaveValue(/connect-src rule \(copied from default-src\) with https:\/\/www\.googletagmanager\.com/);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();

  // Other audiences get their own report.
  await page.getByRole('radio', { name: /Developers/ }).click();
  await expect(page.locator('pre.diff')).toContainText('+ connect-src');
  await page.getByRole('radio', { name: /Security/ }).click();
  await expect(page.locator('.findings').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('restores the analysis from a share link', async ({ page }) => {
  await openAnalyzer(page);
  await page.getByRole('textbox', { name: 'Paste a Content-Security-Policy' }).fill(POLICY);
  await page.getByRole('button', { name: 'Intercom Messenger' }).click();
  const url = page.url();
  expect(url).toContain('#p=');

  const other = await page.context().newPage();
  await openAnalyzer(other, url);
  await expect(other.getByRole('textbox', { name: 'Paste a Content-Security-Policy' })).toHaveValue(POLICY);
  await expect(other.locator('.vendor-result h3')).toHaveText('Intercom Messenger');
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

test('the find-my-csp snippet collects headers and meta tags', async ({ page }) => {
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
  const result = await page.evaluate((code) => new Function(`return ${code}`)(), snippet!);
  expect(result).toBe(
    `content-security-policy: default-src 'self'\n<meta http-equiv="Content-Security-Policy" content="img-src *">`.replace(
      'content-security-policy:',
      'Content-Security-Policy:',
    ),
  );
});
