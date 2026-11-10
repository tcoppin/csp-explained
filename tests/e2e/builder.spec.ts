/** The builder (/build): its steps, what each choice adds to the policy, and the way back to the analyzer. */
import { test, expect, watchErrors, openAnalyzer, openBuilder, pickTool, policyAction, HELLO, HELLO_HASH } from './helpers';

test('builds a policy from nothing, with a catalogue tool and one of our own', async ({ page, context, sent }) => {
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

test('tools picked under a policy that enforces Trusted Types come with a note', async ({ page }) => {
  await openBuilder(page, `/build#b=policy&p=${Buffer.from("default-src 'self'; require-trusted-types-for 'script'").toString('base64url')}&v=hotjar:tracking&step=tools`);
  await expect(page.locator('.trusted-types-note')).toBeVisible();
});
